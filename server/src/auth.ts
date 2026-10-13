import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** Hash the client's authKey (already an Argon2id output) once more so a DB leak is not a login. */
export function hashAuthKey(authKey: string, salt = randomBytes(16).toString('base64')): {
  hash: string
  salt: string
} {
  const hash = scryptSync(Buffer.from(authKey, 'base64'), Buffer.from(salt, 'base64'), 32, SCRYPT)
  return { hash: hash.toString('base64'), salt }
}

export function verifyAuthKey(authKey: string, hash: string, salt: string): boolean {
  const got = Buffer.from(hashAuthKey(authKey, salt).hash, 'base64')
  const want = Buffer.from(hash, 'base64')
  return got.length === want.length && timingSafeEqual(got, want)
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: tokenHash(token) }
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64')
}

/**
 * KDF parameters for an unknown username, derived from a server secret so the
 * prelogin endpoint answers the same way for real and fake accounts.
 */
export function fakeKdf(secret: string, username: string): Record<string, unknown> {
  const salt = createHmac('sha256', secret).update(username.toLowerCase()).digest().subarray(0, 16)
  return { alg: 'argon2id', salt: salt.toString('base64'), m: 65536, t: 3, p: 1 }
}

/** Fixed-window limiter for login attempts, keyed by IP and username. */
export class Limiter {
  private hits = new Map<string, { n: number; until: number }>()
  private max: number
  private windowMs: number

  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }

  blocked(key: string): boolean {
    const h = this.hits.get(key)
    if (!h) return false
    if (Date.now() > h.until) {
      this.hits.delete(key)
      return false
    }
    return h.n >= this.max
  }

  fail(key: string): void {
    const h = this.hits.get(key)
    if (!h || Date.now() > h.until) this.hits.set(key, { n: 1, until: Date.now() + this.windowMs })
    else h.n++
  }

  reset(key: string): void {
    this.hits.delete(key)
  }
}
