import { open, seal } from './crypto'

/**
 * Frame sealing for live terminal sharing.
 *
 * Every frame is XChaCha20-Poly1305 sealed with associated data
 * `termos-share-v1|<shareId>|<direction>|<sender>|<counter>`:
 *  - direction stops the relay from reflecting host output back as viewer input,
 *  - the strictly increasing counter (per sender) stops replays,
 *  - the sender id for viewer input is chosen by the viewer and sealed, so the relay
 *    cannot replay one viewer's keystrokes under a made-up new viewer.
 */

export const HOST = 'host'

interface Frame {
  s: string
  n: number
  nonce: string
  ct: string
}

export class FrameCodec {
  private key: Uint8Array
  private shareId: string
  private sent = 0
  private seen = new Map<string, number>()

  constructor(key: Uint8Array, shareId: string) {
    this.key = key
    this.shareId = shareId
  }

  private aad(dir: string, sender: string, n: number): string {
    return `termos-share-v1|${this.shareId}|${dir}|${sender}|${n}`
  }

  encode(dir: 'h2v' | 'v2h', sender: string, text: string): string {
    const n = ++this.sent
    const frame: Frame = { s: sender, n, ...seal(this.key, text, this.aad(dir, sender, n)) }
    return JSON.stringify(frame)
  }

  /** Returns null for anything forged, tampered, reflected or replayed. */
  decode(dir: 'h2v' | 'v2h', raw: unknown): string | null {
    try {
      const f = JSON.parse(String(raw)) as Frame
      if (typeof f.s !== 'string' || f.s.length > 64 || !Number.isSafeInteger(f.n) || f.n < 1)
        return null
      if (dir === 'h2v' && f.s !== HOST) return null
      if (dir === 'v2h' && f.s === HOST) return null
      if (f.n <= (this.seen.get(f.s) ?? 0)) return null
      const text = open(this.key, f, this.aad(dir, f.s, f.n))
      this.seen.set(f.s, f.n)
      return text
    } catch {
      return null
    }
  }
}
