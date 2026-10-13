import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { b64, open, seal, unb64 } from './crypto'
import { sessions, type Backend, type SessionContext } from './sessions/manager'
import { vault } from './vault'

/**
 * Live terminal sharing through the self-hosted server's relay.
 * The link is `<serverUrl>/share/<shareId>#<key>`; the key never reaches the server,
 * every frame is XChaCha20-Poly1305 sealed with it.
 */

export interface ShareInfo {
  sessionId: string
  link: string
  allowInput: boolean
  viewers: { id: string; username: string }[]
}

interface ActiveShare extends ShareInfo {
  ws: WebSocket
  key: Uint8Array
  untap: () => void
  /** Recent output so a viewer who joins late sees the current screen context. */
  backlog: string
}

const BACKLOG = 64 * 1024

function account(): { serverUrl: string; token: string } {
  const s = vault.get().settings.sync
  if (!s.token || !s.serverUrl)
    throw new Error('Masuk ke server sync dulu (menu Sync & tim) untuk berbagi sesi')
  return { serverUrl: s.serverUrl, token: s.token }
}

function wsUrl(serverUrl: string, path: string): string {
  return serverUrl.replace(/^http/, 'ws') + path
}

const encode = (key: Uint8Array, text: string): string => JSON.stringify(seal(key, text))
const decode = (key: Uint8Array, frame: string): string => open(key, JSON.parse(frame))

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
      headers: { Authorization: `Bearer ${token}` }
    })
    const shareId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server tidak menjawab')), 15000)
      ws.once('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Gagal terhubung ke relay: ${err.message}`))
      })
      ws.once('unexpected-response', (_req, res) => {
        clearTimeout(timer)
        reject(new Error(`Relay menolak (HTTP ${res.statusCode})`))
      })
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.t === 'ready') {
          clearTimeout(timer)
          resolve(msg.shareId)
        }
      })
    })

    const share: ActiveShare = {
      sessionId,
      link: `${serverUrl}/share/${shareId}#${b64(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`,
      allowInput,
      viewers: [],
      ws,
      key,
      backlog: '',
      untap: () => {}
    }
    share.untap = sessions.tap(sessionId, (data) => {
      share.backlog = (share.backlog + data).slice(-BACKLOG)
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'out', data: encode(key, data) }))
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.t === 'joined') {
        share.viewers.push({ id: msg.viewer, username: msg.username })
        ws.send(JSON.stringify({ t: 'to', viewer: msg.viewer, data: encode(key, share.backlog) }))
        this.changed()
      } else if (msg.t === 'left') {
        share.viewers = share.viewers.filter((v) => v.id !== msg.viewer)
        this.changed()
      } else if (msg.t === 'from' && share.allowInput) {
        try {
          sessions.write(sessionId, decode(key, msg.data))
        } catch {
          /* frame not sealed with our key; ignore */
        }
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

/** Parse `<server>/share/<id>#<key>` and check it points at the server we are logged in to. */
export function parseInvite(invite: string): {
  serverUrl: string
  shareId: string
  key: Uint8Array
} {
  const m = /^(https?:\/\/.+?)\/share\/([\w-]+)#([\w-]+)$/.exec(invite.trim())
  if (!m) throw new Error('Link sesi bersama tidak valid')
  const key = unb64(m[3].replace(/-/g, '+').replace(/_/g, '/'))
  if (key.length !== 32) throw new Error('Kunci di link sesi bersama rusak')
  return { serverUrl: m[1], shareId: m[2], key }
}

/** Viewer side: a terminal backend fed by the relay. */
export function joinShare(ctx: SessionContext, invite: string): Promise<Backend> {
  const { serverUrl, shareId, key } = parseInvite(invite)
  const acct = account()
  if (acct.serverUrl !== serverUrl)
    throw new Error(`Link ini dari server ${serverUrl}, sedangkan kamu masuk ke ${acct.serverUrl}`)
  const ws = new WebSocket(wsUrl(serverUrl, `/api/share/join/${shareId}`), {
    headers: { Authorization: `Bearer ${acct.token}` }
  })
  return new Promise((resolve, reject) => {
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`Relay menolak (HTTP ${res.statusCode})`))
    )
    ws.once('error', (err) => reject(new Error(`Gagal terhubung ke relay: ${err.message}`)))
    ws.once('open', () => {
      ctx.emitData(
        '\x1b[90m[menonton sesi bersama; ketikan hanya diteruskan bila host mengizinkan]\x1b[0m\r\n'
      )
      resolve({
        write: (d) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'in', data: encode(key, d) }))
        },
        resize: () => {},
        close: () => ws.close()
      })
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.t === 'data') {
        try {
          ctx.emitData(decode(key, msg.data))
        } catch {
          ctx.emitData('\r\n\x1b[31m[data tidak bisa dibuka: kunci di link salah]\x1b[0m\r\n')
        }
      } else if (msg.t === 'ended') {
        ctx.emitData('\r\n\x1b[90m[host mengakhiri sesi bersama]\x1b[0m\r\n')
      }
    })
    ws.on('close', (code, reason) => {
      if (code >= 4000) ctx.emitData(`\r\n\x1b[90m[${reason.toString() || 'terputus'}]\x1b[0m\r\n`)
      ctx.setStatus('closed')
    })
  })
}
