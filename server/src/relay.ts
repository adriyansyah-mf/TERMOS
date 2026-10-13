import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'

/**
 * Live terminal sharing relay. Payloads are encrypted by the clients with a key
 * that lives only in the share link, so the relay forwards opaque strings.
 *
 * host   -> server: {t:'out', data}                 broadcast to every viewer
 *                   {t:'to', viewer, data}           to one viewer (e.g. initial screen)
 *                   {t:'kick', viewer}
 * viewer -> server: {t:'in', data}                  forwarded to the host
 * server -> host:   {t:'ready', shareId} | {t:'joined', viewer, username} | {t:'left', viewer} | {t:'from', viewer, data}
 * server -> viewer: {t:'data', data} | {t:'ended'}
 */
interface Share {
  host: WebSocket
  ownerId: string
  viewers: Map<string, { ws: WebSocket; username: string }>
}

const MAX_MESSAGE = 1024 * 1024
const MAX_VIEWERS = 16

export class Relay {
  private shares = new Map<string, Share>()

  host(ws: WebSocket, ownerId: string): void {
    const shareId = randomBytes(12).toString('base64url')
    const share: Share = { host: ws, ownerId, viewers: new Map() }
    this.shares.set(shareId, share)
    ws.send(JSON.stringify({ t: 'ready', shareId }))

    ws.on('message', (raw) => {
      if ((raw as Buffer).length > MAX_MESSAGE) return
      let msg: { t?: string; viewer?: string; data?: string }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.t === 'out' && typeof msg.data === 'string') {
        const frame = JSON.stringify({ t: 'data', data: msg.data })
        for (const v of share.viewers.values()) v.ws.send(frame)
      } else if (msg.t === 'to' && msg.viewer && typeof msg.data === 'string') {
        share.viewers.get(msg.viewer)?.ws.send(JSON.stringify({ t: 'data', data: msg.data }))
      } else if (msg.t === 'kick' && msg.viewer) {
        share.viewers.get(msg.viewer)?.ws.close(4003, 'Dikeluarkan oleh host')
      }
    })
    ws.on('close', () => {
      this.shares.delete(shareId)
      for (const v of share.viewers.values()) {
        v.ws.send(JSON.stringify({ t: 'ended' }))
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
    const viewer = randomBytes(6).toString('base64url')
    share.viewers.set(viewer, { ws, username })
    share.host.send(JSON.stringify({ t: 'joined', viewer, username }))

    ws.on('message', (raw) => {
      if ((raw as Buffer).length > MAX_MESSAGE) return
      let msg: { t?: string; data?: string }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      // The host decides whether viewer input is allowed; the relay just forwards.
      if (msg.t === 'in' && typeof msg.data === 'string')
        share.host.send(JSON.stringify({ t: 'from', viewer, data: msg.data }))
    })
    ws.on('close', () => {
      share.viewers.delete(viewer)
      if (share.host.readyState === share.host.OPEN) share.host.send(JSON.stringify({ t: 'left', viewer }))
    })
  }

  count(): number {
    return this.shares.size
  }
}
