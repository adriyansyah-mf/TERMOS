import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'

/**
 * Live terminal sharing relay. Payloads are sealed by the clients with a key that
 * lives only in the share link, so the relay forwards opaque strings. The clients
 * bind direction and a counter into every frame, so the relay cannot reflect host
 * output back as viewer input or replay frames.
 *
 * host   -> server: {t:'out', data} broadcast | {t:'to', viewer, data} | {t:'kick', viewer}
 * viewer -> server: {t:'in', data}
 * server -> host:   {t:'ready', shareId} | {t:'joined', viewer, username} | {t:'left', viewer} | {t:'from', viewer, data}
 * server -> viewer: {t:'data', data} | {t:'ended'}
 */
interface Peer {
  ws: WebSocket
  alive: boolean
  window: number
  count: number
}

interface Share {
  host: Peer
  ownerId: string
  viewers: Map<string, Peer & { username: string }>
}

const MAX_MESSAGE = 512 * 1024
const MAX_VIEWERS = 16
const MAX_SHARES_PER_USER = 5
/** Frames per peer per second; terminal output is chunked, so this is generous. */
const MAX_RATE = 400
/** A viewer this far behind is not keeping up; drop it instead of buffering without bound. */
const MAX_BUFFERED = 4 * 1024 * 1024

function peer(ws: WebSocket): Peer {
  const p: Peer = { ws, alive: true, window: Date.now(), count: 0 }
  ws.on('pong', () => (p.alive = true))
  // Protocol errors (oversized or malformed frames) arrive as 'error' events; without a
  // listener they would be thrown and take the whole server down. ws closes the socket itself.
  ws.on('error', () => {})
  return p
}

/** Send only to open sockets, and cut off a peer whose send buffer keeps growing. */
function deliver(p: Peer, frame: string): void {
  if (p.ws.readyState !== p.ws.OPEN) return
  if (p.ws.bufferedAmount > MAX_BUFFERED) {
    p.ws.terminate()
    return
  }
  p.ws.send(frame)
}

/** Drop the connection if it floods; returns false when the frame must be ignored. */
function admit(p: Peer, size: number): boolean {
  if (size > MAX_MESSAGE) {
    p.ws.close(1009, 'Pesan terlalu besar')
    return false
  }
  const now = Date.now()
  if (now - p.window > 1000) {
    p.window = now
    p.count = 0
  }
  if (++p.count > MAX_RATE) {
    p.ws.close(1008, 'Terlalu banyak pesan')
    return false
  }
  return true
}

function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(raw))
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

export class Relay {
  private shares = new Map<string, Share>()

  constructor() {
    // Heartbeat: a peer that misses a ping round is gone (laptop slept, network died).
    setInterval(() => {
      for (const s of this.shares.values())
        for (const p of [s.host, ...s.viewers.values()]) {
          if (!p.alive) p.ws.terminate()
          else {
            p.alive = false
            p.ws.ping()
          }
        }
    }, 30_000).unref()
  }

  host(ws: WebSocket, ownerId: string): void {
    const active = [...this.shares.values()].filter((s) => s.ownerId === ownerId).length
    if (active >= MAX_SHARES_PER_USER) {
      ws.close(4006, 'Maksimal 5 sesi dibagikan bersamaan')
      return
    }
    const shareId = randomBytes(16).toString('base64url')
    const share: Share = { host: peer(ws), ownerId, viewers: new Map() }
    this.shares.set(shareId, share)
    ws.send(JSON.stringify({ t: 'ready', shareId }))

    ws.on('message', (raw: Buffer) => {
      if (!admit(share.host, raw.length)) return
      const msg = parse(raw)
      if (!msg) return
      if (msg.t === 'out' && typeof msg.data === 'string') {
        const frame = JSON.stringify({ t: 'data', data: msg.data })
        for (const v of share.viewers.values()) deliver(v, frame)
      } else if (msg.t === 'to' && typeof msg.viewer === 'string' && typeof msg.data === 'string') {
        const v = share.viewers.get(msg.viewer)
        if (v) deliver(v, JSON.stringify({ t: 'data', data: msg.data }))
      } else if (msg.t === 'kick' && typeof msg.viewer === 'string') {
        share.viewers.get(msg.viewer)?.ws.close(4003, 'Dikeluarkan oleh host')
      }
    })
    ws.on('close', () => {
      this.shares.delete(shareId)
      for (const v of share.viewers.values()) {
        deliver(v, JSON.stringify({ t: 'ended' }))
        v.ws.close(1000, 'Sesi selesai')
      }
    })
  }

  join(ws: WebSocket, shareId: string, username: string): void {
    const share = this.shares.get(shareId)
    if (!share) {
      ws.close(4004, 'Sesi bersama tidak ditemukan atau sudah selesai')
      return
    }
    if (share.viewers.size >= MAX_VIEWERS) {
      ws.close(4005, 'Penonton sudah penuh')
      return
    }
    const viewer = randomBytes(9).toString('base64url')
    const p = { ...peer(ws), username }
    share.viewers.set(viewer, p)
    deliver(share.host, JSON.stringify({ t: 'joined', viewer, username }))

    ws.on('message', (raw: Buffer) => {
      if (!admit(p, raw.length)) return
      const msg = parse(raw)
      // The host decides whether viewer input is allowed; the relay only forwards.
      if (msg?.t === 'in' && typeof msg.data === 'string')
        deliver(share.host, JSON.stringify({ t: 'from', viewer, data: msg.data }))
    })
    ws.on('close', () => {
      share.viewers.delete(viewer)
      deliver(share.host, JSON.stringify({ t: 'left', viewer }))
    })
  }

  count(): number {
    return this.shares.size
  }

  /** Graceful shutdown: tell everyone the relay is going away. */
  closeAll(): void {
    for (const s of this.shares.values())
      for (const p of [s.host, ...s.viewers.values()]) p.ws.close(1001, 'Server berhenti')
  }
}
