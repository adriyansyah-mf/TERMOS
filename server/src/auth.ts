import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function scryptAsync(data: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(data, salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)))
  )
}

/** Hash the client's authKey (already an Argon2id output) once more, so a DB leak is not a login. */
export async function hashAuthKey(
  authKey: string,
  salt = randomBytes(16).toString('base64')
): Promise<{ hash: string; salt: string }> {
  const hash = await scryptAsync(Buffer.from(authKey, 'base64'), Buffer.from(salt, 'base64'))
  return { hash: hash.toString('base64'), salt }
}

export async function verifyAuthKey(authKey: string, hash: string, salt: string): Promise<boolean> {
  const got = Buffer.from((await hashAuthKey(authKey, salt)).hash, 'base64')
  const want = Buffer.from(hash, 'base64')
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Burns the same scrypt work as a real check, so unknown usernames cannot be told apart by timing. */
const DUMMY = { hash: randomBytes(32).toString('base64'), salt: randomBytes(16).toString('base64') }
export async function verifyAgainstDummy(authKey: string): Promise<false> {
  await verifyAuthKey(authKey, DUMMY.hash, DUMMY.salt)
  return false
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

/** Fixed-window counter keyed by anything (IP, IP+username, user id). In memory, per process. */
export class Limiter {
  private hits = new Map<string, { n: number; until: number }>()
  private max: number
  private windowMs: number

  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
    setInterval(() => this.sweep(), windowMs).unref()
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

  hit(key: string): void {
    const h = this.hits.get(key)
    if (!h || Date.now() > h.until) this.hits.set(key, { n: 1, until: Date.now() + this.windowMs })
    else h.n++
  }

  /** Count and report whether the key is over the limit after this hit. */
  take(key: string): boolean {
    this.hit(key)
    return this.blocked(key)
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  private sweep(): void {
    const now = Date.now()
    for (const [k, h] of this.hits) if (now > h.until) this.hits.delete(k)
  }
}
