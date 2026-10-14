import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { b64, unb64 } from './crypto'
import { fmt, tr } from './i18n'
import { FrameCodec, HOST } from './shareCodec'
import { sessions, type Backend, type SessionContext } from './sessions/manager'
import { vault } from './vault'

const S = {
  id: {
    loginFirst: 'Masuk ke server sync dulu (menu Sync & tim) untuk berbagi sesi',
    serverNoAnswer: 'Server tidak menjawab',
    relayConnectFailed: 'Gagal terhubung ke relay: %s',
    relayRefused: 'Relay menolak (HTTP %s)',
    invalidLink: 'Link sesi bersama tidak valid',
    brokenKey: 'Kunci di link sesi bersama rusak',
    wrongServer: 'Link ini dari server %s, sedangkan kamu masuk ke %s',
    watchingNote:
      '\x1b[90m[menonton sesi bersama; ketikan hanya diteruskan bila host mengizinkan]\x1b[0m\r\n',
    hostEnded: '\r\n\x1b[90m[host mengakhiri sesi bersama]\x1b[0m\r\n',
    disconnected: 'terputus'
  },
  en: {
    loginFirst: 'Sign in to the sync server first (Sync & team menu) to share a session',
    serverNoAnswer: 'Server did not respond',
    relayConnectFailed: 'Failed to connect to relay: %s',
    relayRefused: 'Relay refused (HTTP %s)',
    invalidLink: 'Invalid shared session link',
    brokenKey: 'Key in the shared session link is corrupt',
    wrongServer: 'This link is from server %s, but you are signed in to %s',
    watchingNote:
      '\x1b[90m[watching a shared session; keystrokes are only forwarded if the host allows]\x1b[0m\r\n',
    hostEnded: '\r\n\x1b[90m[host ended the shared session]\x1b[0m\r\n',
    disconnected: 'disconnected'
  }
}

/**
 * Live terminal sharing through the self-hosted server's relay.
 * The link is `<serverUrl>/share/<shareId>#<key>`; the key never reaches the server.
 * Frame sealing (direction, counters, sender binding) lives in shareCodec.ts.
 */

export interface ShareInfo {
  sessionId: string
  link: string
  allowInput: boolean
  viewers: { id: string; username: string }[]
}

interface ActiveShare extends ShareInfo {
  ws: WebSocket
  untap: () => void
  /** Recent output so a viewer who joins late sees the current screen context. */
  backlog: string
}

const BACKLOG = 64 * 1024

function account(): { serverUrl: string; token: string } {
  const s = vault.get().settings.sync
  if (!s.token || !s.serverUrl) throw new Error(tr(S).loginFirst)
  return { serverUrl: s.serverUrl, token: s.token }
}

function wsUrl(serverUrl: string, path: string): string {
  return serverUrl.replace(/^http/, 'ws') + path
}

/** Relay control messages are plaintext JSON; never let a malformed one throw in an event handler. */
function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(raw))
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

class Sharing extends EventEmitter {
  private shares = new Map<string, ActiveShare>()

  list(): ShareInfo[] {
    return [...this.shares.values()].map(({ sessionId, link, allowInput, viewers }) => ({
      sessionId,
      link,
      allowInput,
      viewers
    }))
  }

  private changed(): void {
    this.emit('status', this.list())
  }

  async start(sessionId: string, allowInput: boolean): Promise<ShareInfo> {
    const existing = this.shares.get(sessionId)
    if (existing) return this.list().find((s) => s.sessionId === sessionId)!
    const { serverUrl, token } = account()
    const key = new Uint8Array(randomBytes(32))
    const ws = new WebSocket(wsUrl(serverUrl, '/api/share/host'), {
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: 1024 * 1024
    })
    const shareId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(tr(S).serverNoAnswer)), 15000)
      ws.once('error', (err) => {
        clearTimeout(timer)
        reject(new Error(fmt(tr(S).relayConnectFailed, err.message)))
      })
      ws.once('unexpected-response', (_req, res) => {
        clearTimeout(timer)
        reject(new Error(fmt(tr(S).relayRefused, String(res.statusCode))))
      })
      ws.on('message', (raw) => {
        const msg = parse(raw)
        if (
          msg?.t === 'ready' &&
          typeof msg.shareId === 'string' &&
          /^[\w-]{16,40}$/.test(msg.shareId)
        ) {
          clearTimeout(timer)
          resolve(msg.shareId)
        }
      })
    })
    ws.on('error', () => {
      /* reported through 'close' */
    })

    const codec = new FrameCodec(key, shareId)
    const share: ActiveShare = {
      sessionId,
      link: `${serverUrl}/share/${shareId}#${b64(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`,
      allowInput,
      viewers: [],
      ws,
      backlog: '',
      untap: () => {}
    }
    share.untap = sessions.tap(sessionId, (data) => {
      share.backlog = (share.backlog + data).slice(-BACKLOG)
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ t: 'out', data: codec.encode('h2v', HOST, data) }))
    })
    ws.on('message', (raw) => {
      const msg = parse(raw)
      if (!msg) return
      if (msg.t === 'joined' && typeof msg.viewer === 'string') {
        share.viewers.push({ id: msg.viewer, username: String(msg.username ?? '?').slice(0, 64) })
        ws.send(
          JSON.stringify({
            t: 'to',
            viewer: msg.viewer,
            data: codec.encode('h2v', HOST, share.backlog)
          })
        )
        this.changed()
      } else if (msg.t === 'left') {
        share.viewers = share.viewers.filter((v) => v.id !== msg.viewer)
        this.changed()
      } else if (msg.t === 'from' && share.allowInput) {
        const text = codec.decode('v2h', msg.data)
        if (text !== null) sessions.write(sessionId, text)
      }
    })
    ws.on('close', () => {
      share.untap()
      this.shares.delete(sessionId)
      this.changed()
    })
    this.shares.set(sessionId, share)
    this.changed()
    return this.list().find((s) => s.sessionId === sessionId)!
  }

  setAllowInput(sessionId: string, allow: boolean): void {
    const s = this.shares.get(sessionId)
    if (s) {
      s.allowInput = allow
      this.changed()
    }
  }

  kick(sessionId: string, viewer: string): void {
    this.shares.get(sessionId)?.ws.send(JSON.stringify({ t: 'kick', viewer }))
  }

  stop(sessionId: string): void {
    const s = this.shares.get(sessionId)
    if (!s) return
    s.untap()
    s.ws.close()
    this.shares.delete(sessionId)
    this.changed()
  }

  stopAll(): void {
    for (const id of [...this.shares.keys()]) this.stop(id)
  }
}

export const sharing = new Sharing()

/** Parse `<server>/share/<id>#<key>`. */
export function parseInvite(invite: string): {
  serverUrl: string
  shareId: string
  key: Uint8Array
} {
  const m = /^(https?:\/\/[^\s#]+?)\/share\/([\w-]{16,40})#([\w-]{40,48})$/.exec(invite.trim())
  if (!m) throw new Error(tr(S).invalidLink)
  const key = unb64(m[3].replace(/-/g, '+').replace(/_/g, '/'))
  if (key.length !== 32) throw new Error(tr(S).brokenKey)
  return { serverUrl: m[1], shareId: m[2], key }
}

/** Viewer side: a terminal backend fed by the relay. */
export function joinShare(ctx: SessionContext, invite: string): Promise<Backend> {
  const { serverUrl, shareId, key } = parseInvite(invite)
  const acct = account()
  // Only ever send our sync token to the server we are logged in to.
  if (acct.serverUrl !== serverUrl)
    throw new Error(fmt(tr(S).wrongServer, serverUrl, acct.serverUrl))
  const codec = new FrameCodec(key, shareId)
  const me = randomBytes(9).toString('base64url')
  const ws = new WebSocket(wsUrl(serverUrl, `/api/share/join/${shareId}`), {
    headers: { Authorization: `Bearer ${acct.token}` },
    maxPayload: 1024 * 1024
  })
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(fmt(tr(S).relayRefused, String(res.statusCode))))
    )
    ws.on('error', (err) => reject(new Error(fmt(tr(S).relayConnectFailed, err.message))))
    ws.once('open', () => {
      ctx.emitData(tr(S).watchingNote)
      resolve({
        write: (d) => {
          if (ws.readyState === ws.OPEN)
            ws.send(JSON.stringify({ t: 'in', data: codec.encode('v2h', me, d) }))
        },
        resize: () => {},
        close: () => ws.close()
      })
    })
    ws.on('message', (raw) => {
      const msg = parse(raw)
      if (msg?.t === 'data') {
        const text = codec.decode('h2v', msg.data)
        if (text !== null) ctx.emitData(text)
      } else if (msg?.t === 'ended') {
        ctx.emitData(tr(S).hostEnded)
      }
    })
    ws.on('close', (code, reason) => {
      if (code >= 4000)
        ctx.emitData(
          `\r\n\x1b[90m[${reason.toString().slice(0, 100) || tr(S).disconnected}]\x1b[0m\r\n`
        )
      ctx.setStatus('closed')
    })
  })
}
