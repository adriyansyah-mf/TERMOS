import type { WebContents } from 'electron'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { newId } from '../../shared/merge'
import type { HistoryEntry, SessionEvent } from '../../shared/types'
import { dataDir, vault } from '../vault'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A running terminal backend (ssh shell, pty, telnet socket, ...). */
export interface Backend {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export interface SessionContext {
  id: string
  hostId?: string
  label: string
  emitData(data: string): void
  setStatus(status: 'connecting' | 'connected' | 'closed' | 'error', message?: string): void
  ask<T>(
    event: DistributiveOmit<Extract<SessionEvent, { requestId: string }>, 'sessionId' | 'requestId'>
  ): Promise<T>
}

interface Session {
  ctx: SessionContext
  backend?: Backend
  log?: WriteStream
  inputLine: string
  lastOutputTail: string
  listeners: Set<(data: string) => void>
}

const PASSWORD_PROMPT = /(password|passphrase|pin|verification code|otp)[^\n]*:\s*$/i

class SessionManager {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, (answer: unknown) => void>()
  private web: WebContents | null = null

  attach(web: WebContents): void {
    this.web = web
  }

  private send(ev: SessionEvent): void {
    if (this.web && !this.web.isDestroyed()) this.web.send('session:event', ev)
  }

  create(label: string, hostId?: string, logSession = false): SessionContext {
    const id = newId()
    const session: Session = {
      inputLine: '',
      lastOutputTail: '',
      listeners: new Set()
    } as unknown as Session
    const ctx: SessionContext = {
      id,
      hostId,
      label,
      emitData: (data) => {
        session.lastOutputTail = (session.lastOutputTail + data).slice(-200)
        session.log?.write(data)
        for (const l of session.listeners) l(data)
        this.send({ type: 'data', sessionId: id, data })
      },
      setStatus: (status, message) => this.send({ type: 'status', sessionId: id, status, message }),
      ask: <T>(event) =>
        new Promise<T>((resolve) => {
          const requestId = newId()
          this.pending.set(requestId, resolve as (a: unknown) => void)
          this.send({ ...event, sessionId: id, requestId } as SessionEvent)
        })
    }
    session.ctx = ctx
    if (logSession) {
      const dir = join(dataDir(), 'logs')
      mkdirSync(dir, { recursive: true })
      const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '_')
      session.log = createWriteStream(
        join(dir, `${safe}_${new Date().toISOString().replace(/[:.]/g, '-')}.log`),
        {
          mode: 0o600
        }
      )
    }
    this.sessions.set(id, session)
    return ctx
  }

  setBackend(id: string, backend: Backend): void {
    const s = this.sessions.get(id)
    if (s) s.backend = backend
    else backend.close()
  }

  answer(requestId: string, value: unknown): void {
    const fn = this.pending.get(requestId)
    this.pending.delete(requestId)
    fn?.(value)
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (!s?.backend) return
    this.trackInput(s, data)
    s.backend.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.backend?.resize(cols, rows)
  }

  close(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    s.backend?.close()
    s.log?.end()
  }

  ended(id: string): void {
    const s = this.sessions.get(id)
    s?.log?.end()
    if (s) s.log = undefined
  }

  /** Tap a session's output (used by multiplayer sharing). */
  tap(id: string, fn: (data: string) => void): () => void {
    const s = this.sessions.get(id)
    s?.listeners.add(fn)
    return () => s?.listeners.delete(fn)
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  /** Best-effort command history: reconstruct the typed line, skip password prompts. */
  private trackInput(s: Session, data: string): void {
    if (!s.ctx.hostId || !vault.isUnlocked() || !vault.get().settings.recordHistory) return
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const cmd = s.inputLine.trim()
        s.inputLine = ''
        if (cmd && !PASSWORD_PROMPT.test(s.lastOutputTail.split('\n').pop() ?? ''))
          this.record(s.ctx.hostId, cmd)
      } else if (ch === '\x7f' || ch === '\b') {
        s.inputLine = s.inputLine.slice(0, -1)
      } else if (ch === '\x03' || ch === '\x15') {
        s.inputLine = ''
      } else if (ch === '\x1b') {
        // Arrow keys / history recall make the line unknowable; drop it.
        s.inputLine = '\x00'
      } else if (ch >= ' ' && !s.inputLine.startsWith('\x00')) {
        s.inputLine += ch
      }
    }
    if (s.inputLine.startsWith('\x00') && /[\r\n]/.test(data)) s.inputLine = ''
  }

  private record(hostId: string, command: string): void {
    const list = vault.get().history
    const last = list.filter((h) => h.hostId === hostId && !h.deleted).at(-1)
    if (last?.command === command) return
    const entry: HistoryEntry = {
      id: newId(),
      hostId,
      command,
      at: Date.now(),
      updatedAt: Date.now()
    }
    list.push(entry)
    // Cap history so the vault stays small.
    const live = list.filter((h) => !h.deleted)
    if (live.length > 5000) vault.get().history = live.slice(-5000)
    vault.changed()
  }
}

export const sessions = new SessionManager()
