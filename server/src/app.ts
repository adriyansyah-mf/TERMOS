import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  fakeKdf,
  hashAuthKey,
  Limiter,
  newToken,
  tokenHash,
  verifyAgainstDummy,
  verifyAuthKey
} from './auth.ts'
import { RECORD_WRITE_LOCK, withTx, type DB, type Tx } from './db.ts'

export interface Config {
  /** 'first' (default): only the first account may self-register; 'open': anyone; 'invite': needs inviteCode. */
  signup: 'first' | 'open' | 'invite'
  inviteCode?: string
  /** Secret for fake prelogin answers; generated once and kept in the DB. */
  secret: string
  /** Device tokens unused for this long stop working. */
  tokenIdleMs: number
  /** Per vault (personal or team) storage limits. */
  maxRecords: number
  maxBytes: number
  /** Registration attempts per IP per hour. */
  signupPerHour: number
}

interface UserRow {
  id: string
  username: string
  auth_hash: string
  auth_salt: string
  kdf: Record<string, unknown>
  wrapped_key: Record<string, unknown>
  public_key: string
  wrapped_private_key: Record<string, unknown>
  is_admin: boolean
}

export interface Authed {
  user: UserRow
  deviceId: string
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_BODY = 16 * 1024 * 1024
/** What an admin can switch sign-up to at runtime (stored in meta, overrides TERMOS_SIGNUP). */
export type SignupSetting = 'open' | 'invite' | 'closed'
const SIGNUP_SETTINGS: SignupSetting[] = ['open', 'invite', 'closed']
const MAX_ACTIVE_INVITES = 200
/** Logging in again and again must not grow the devices table without bound. */
const MAX_DEVICES = 50
const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── input validation ────────────────────────────────────────────────────────

/** Constant-time comparison for a secret the operator configured. */
function sameSecret(given: string, expected: string | undefined): boolean {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function str(v: unknown, name: string, max = 20000): string {
  if (typeof v !== 'string' || !v || v.length > max)
    throw new HttpError(400, `Field "${name}" tidak valid`)
  return v
}

/** base64 that must decode to exactly `bytes` bytes (keys, salts). */
function b64(v: unknown, name: string, bytes: number): string {
  const s = str(v, name, 200)
  if (!/^[A-Za-z0-9+/]+=*$/.test(s) || Buffer.from(s, 'base64').length !== bytes)
    throw new HttpError(400, `Field "${name}" harus ${bytes} byte base64`)
  return s
}

/** An encrypted box from the client: only these string fields, bounded. */
function box(v: unknown, name: string, fields: string[], max = 4096): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new HttpError(400, `Field "${name}" tidak valid`)
  const out: Record<string, string> = {}
  for (const f of fields) out[f] = str((v as Record<string, unknown>)[f], `${name}.${f}`, max)
  return out
}

/** Refuse weak KDF settings so a careless or malicious client cannot weaken an account. */
function kdf(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object') throw new HttpError(400, 'Field "kdf" tidak valid')
  const k = v as Record<string, unknown>
  const m = Number(k.m)
  const t = Number(k.t)
  const p = Number(k.p)
  if (
    k.alg !== 'argon2id' ||
    !(m >= 65536 && m <= 1048576) ||
    !(t >= 3 && t <= 20) ||
    !(p >= 1 && p <= 8)
  )
    throw new HttpError(400, 'Parameter KDF terlalu lemah atau tidak valid')
  return { alg: 'argon2id', salt: b64(k.salt, 'kdf.salt', 16), m, t, p }
}

function uuid(v: unknown, name: string): string {
  const s = str(v, name, 36)
  if (!UUID.test(s)) throw new HttpError(400, `Field "${name}" tidak valid`)
  return s
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const type = req.headers['content-type'] ?? ''
    if (!type.startsWith('application/json'))
      throw new HttpError(415, 'Content-Type harus application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Request terlalu besar')
    chunks.push(c as Buffer)
  }
  if (!size) return {}
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new HttpError(400, 'Body bukan objek JSON')
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  })
  res.end(text)
}

export async function loadSecret(db: DB): Promise<string> {
  const fresh = randomBytes(32).toString('base64')
  await db.query("INSERT INTO meta(key, value) VALUES('secret', $1) ON CONFLICT (key) DO NOTHING", [
    fresh
  ])
  const r = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'secret'")
  return r.rows[0].value
}

export class App {
  private db: DB
  private cfg: Config
  /** Per IP+username: brute force on one account. */
  private loginUserLimit = new Limiter(10, 15 * 60 * 1000)
  /** Per IP: spraying many usernames. */
  private loginIpLimit = new Limiter(50, 15 * 60 * 1000)
  /** Per IP: account creation and username probing. */
  private signupLimit: Limiter
  private preloginLimit = new Limiter(120, 60 * 1000)

  constructor(db: DB, cfg: Config) {
    this.db = db
    this.cfg = cfg
    this.signupLimit = new Limiter(cfg.signupPerHour, 60 * 60 * 1000)
  }

  // ── auth ────────────────────────────────────────────────────────────────

  async authenticate(header: string | undefined): Promise<Authed> {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header ?? '')
    if (!m) throw new HttpError(401, 'Belum login')
    const now = Date.now()
    const dev = await this.db.query<{ id: string; user_id: string; last_seen: number }>(
      'SELECT id, user_id, last_seen FROM devices WHERE token_hash = $1',
      [tokenHash(m[1])]
    )
    const d = dev.rows[0]
    if (!d) throw new HttpError(401, 'Sesi tidak berlaku, login lagi')
    if (now - d.last_seen > this.cfg.tokenIdleMs) {
      await this.db.query('DELETE FROM devices WHERE id = $1', [d.id])
      throw new HttpError(401, 'Sesi kedaluwarsa karena lama tidak dipakai, login lagi')
    }
    const user = (await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [d.user_id]))
      .rows[0]
    // The account can be deleted between the two queries.
    if (!user) throw new HttpError(401, 'Sesi tidak berlaku, login lagi')
    // Avoid a write per request; a minute of precision is enough for idle expiry.
    if (now - d.last_seen > 60_000)
      await this.db.query('UPDATE devices SET last_seen = $1 WHERE id = $2', [now, d.id])
    return { user, deviceId: d.id }
  }

  async status(): Promise<{ signup: SignupSetting; users: number }> {
    const n = (await this.db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')).rows[0].n
    return { signup: this.effectiveSignup(await this.signupSetting(this.db), n), users: n }
  }

  /** The admin's runtime choice, or null to follow TERMOS_SIGNUP. */
  private async signupSetting(c: DB | Tx): Promise<SignupSetting | null> {
    const r = await c.query<{ value: string }>("SELECT value FROM meta WHERE key = 'signup'")
    const v = r.rows[0]?.value as SignupSetting | undefined
    return v && SIGNUP_SETTINGS.includes(v) ? v : null
  }

  /**
   * What sign-up looks like to a client. With TERMOS_SIGNUP=first the very first account
   * registers freely and becomes admin; after that, new people need an invite from an admin.
   */
  private effectiveSignup(setting: SignupSetting | null, users: number): SignupSetting {
    if (setting) return setting
    if (this.cfg.signup === 'open') return 'open'
    if (this.cfg.signup === 'first' && users === 0) return 'open'
    return 'invite'
  }

  async prelogin(body: Record<string, unknown>, ip: string): Promise<{ kdf: unknown }> {
    if (this.preloginLimit.take(ip)) throw new HttpError(429, 'Terlalu banyak permintaan')
    const username = str(body.username, 'username', 64)
    const r = await this.db.query<{ kdf: unknown }>(
      'SELECT kdf FROM users WHERE lower(username) = lower($1)',
      [username]
    )
    return { kdf: r.rows[0]?.kdf ?? fakeKdf(this.cfg.secret, username) }
  }

  private async issueDevice(
    c: DB | import('./db.ts').Tx,
    userId: string,
    deviceName: unknown
  ): Promise<{ token: string; deviceId: string }> {
    const { token, hash } = newToken()
    const deviceId = randomUUID()
    const now = Date.now()
    const name =
      typeof deviceName === 'string' && deviceName.trim()
        ? deviceName.trim().slice(0, 80)
        : 'Perangkat'
    await c.query(
      'INSERT INTO devices(id, user_id, name, token_hash, created_at, last_seen) VALUES($1,$2,$3,$4,$5,$6)',
      [deviceId, userId, name, hash, now, now]
    )
    // Keep the most recently used devices; the oldest ones have to log in again.
    await c.query(
      `DELETE FROM devices WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM devices WHERE user_id = $1 ORDER BY last_seen DESC, created_at DESC LIMIT $2)`,
      [userId, MAX_DEVICES]
    )
    return { token, deviceId }
  }

  /** Remove device tokens that have been idle past the expiry window. */
  async sweepDevices(): Promise<number> {
    const r = await this.db.query('DELETE FROM devices WHERE last_seen < $1', [
      Date.now() - this.cfg.tokenIdleMs
    ])
    // Expired, never-used invites are only noise in the admin list after a month.
    await this.db.query('DELETE FROM invites WHERE used_at IS NULL AND expires_at < $1', [
      Date.now() - 30 * 86_400_000
    ])
    return r.rowCount ?? 0
  }

  async register(body: Record<string, unknown>, ip: string): Promise<Record<string, unknown>> {
    if (this.signupLimit.take(ip))
      throw new HttpError(429, 'Terlalu banyak pendaftaran dari alamat ini')
    const username = str(body.username, 'username', 40)
    if (!USERNAME.test(username))
      throw new HttpError(400, 'Username 3-40 karakter: huruf, angka, titik, minus, garis bawah')
    const authKey = b64(body.authKey, 'authKey', 32)
    const k = kdf(body.kdf)
    const wrappedKey = box(body.wrappedKey, 'wrappedKey', ['nonce', 'ct'])
    const publicKey = b64(body.publicKey, 'publicKey', 32)
    const wrappedPrivateKey = box(body.wrappedPrivateKey, 'wrappedPrivateKey', ['nonce', 'ct'])
    const { hash, salt } = await hashAuthKey(authKey)

    return withTx(this.db, async (c) => {
      // Serialize sign-ups so "first account becomes admin" cannot race.
      await c.query('SELECT pg_advisory_xact_lock(4244)')
      const n = (await c.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')).rows[0].n
      const mode = this.effectiveSignup(await this.signupSetting(c), n)
      const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : ''
      let inviteId: string | undefined
      if (mode === 'closed') throw new HttpError(403, 'Pendaftaran ditutup oleh admin server')
      if (mode === 'invite') {
        if (!code) throw new HttpError(403, 'Pendaftaran butuh kode undangan dari admin server')
        // TERMOS_INVITE_CODE stays valid as a reusable code in invite mode.
        const envOk = this.cfg.signup === 'invite' && sameSecret(code, this.cfg.inviteCode)
        if (!envOk) {
          const inv = await c.query<{ id: string }>(
            'SELECT id FROM invites WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE',
            [tokenHash(code), Date.now()]
          )
          if (!inv.rowCount)
            throw new HttpError(403, 'Kode undangan salah, sudah dipakai, atau kedaluwarsa')
          inviteId = inv.rows[0].id
        }
      }
      const taken = await c.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [
        username
      ])
      if (taken.rowCount) throw new HttpError(409, 'Username sudah dipakai')
      const id = randomUUID()
      await c.query(
        `INSERT INTO users(id, username, auth_hash, auth_salt, kdf, wrapped_key, public_key, wrapped_private_key, is_admin, created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, username, hash, salt, k, wrappedKey, publicKey, wrappedPrivateKey, n === 0, Date.now()]
      )
      if (inviteId)
        await c.query('UPDATE invites SET used_at = $1, used_username = $2 WHERE id = $3', [
          Date.now(),
          username,
          inviteId
        ])
      const { token, deviceId } = await this.issueDevice(c, id, body.deviceName)
      return { userId: id, token, deviceId, isAdmin: n === 0 }
    })
  }

  async login(body: Record<string, unknown>, ip: string): Promise<Record<string, unknown>> {
    const username = str(body.username, 'username', 64)
    const authKey = b64(body.authKey, 'authKey', 32)
    const userKey = `${ip}|${username.toLowerCase()}`
    if (this.loginUserLimit.blocked(userKey) || this.loginIpLimit.blocked(ip))
      throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.')
    const user = (
      await this.db.query<UserRow>('SELECT * FROM users WHERE lower(username) = lower($1)', [
        username
      ])
    ).rows[0]
    const ok = user
      ? await verifyAuthKey(authKey, user.auth_hash, user.auth_salt)
      : await verifyAgainstDummy(authKey)
    if (!ok) {
      this.loginUserLimit.hit(userKey)
      this.loginIpLimit.hit(ip)
      throw new HttpError(401, 'Username atau password salah')
    }
    this.loginUserLimit.reset(userKey)
    const { token, deviceId } = await this.issueDevice(this.db, user.id, body.deviceName)
    return { token, deviceId, ...(await this.profile(user)) }
  }

  private async profile(user: UserRow): Promise<Record<string, unknown>> {
    return {
      userId: user.id,
      username: user.username,
      isAdmin: user.is_admin,
      kdf: user.kdf,
      wrappedKey: user.wrapped_key,
      publicKey: user.public_key,
      wrappedPrivateKey: user.wrapped_private_key,
      teams: await this.teamsOf(user.id)
    }
  }

  me(a: Authed): Promise<Record<string, unknown>> {
    return this.profile(a.user)
  }

  async logout(a: Authed): Promise<void> {
    await this.db.query('DELETE FROM devices WHERE id = $1', [a.deviceId])
  }

  private async reauth(a: Authed, authKey: unknown): Promise<void> {
    const key = b64(authKey, 'authKey', 32)
    if (this.loginUserLimit.blocked(`reauth|${a.user.id}`))
      throw new HttpError(429, 'Terlalu banyak percobaan')
    if (!(await verifyAuthKey(key, a.user.auth_hash, a.user.auth_salt))) {
      this.loginUserLimit.hit(`reauth|${a.user.id}`)
      throw new HttpError(403, 'Password akun salah')
    }
  }

  async changePassword(a: Authed, body: Record<string, unknown>): Promise<void> {
    await this.reauth(a, body.authKey)
    const { hash, salt } = await hashAuthKey(b64(body.newAuthKey, 'newAuthKey', 32))
    const k = kdf(body.kdf)
    const wrappedKey = box(body.wrappedKey, 'wrappedKey', ['nonce', 'ct'])
    const wrappedPrivateKey = box(body.wrappedPrivateKey, 'wrappedPrivateKey', ['nonce', 'ct'])
    await withTx(this.db, async (c) => {
      await c.query(
        'UPDATE users SET auth_hash = $1, auth_salt = $2, kdf = $3, wrapped_key = $4, wrapped_private_key = $5 WHERE id = $6',
        [hash, salt, k, wrappedKey, wrappedPrivateKey, a.user.id]
      )
      // Every other device must log in again with the new password.
      await c.query('DELETE FROM devices WHERE user_id = $1 AND id <> $2', [a.user.id, a.deviceId])
    })
  }

  /** Delete the account and everything it owns (personal vault, owned teams). */
  async deleteAccount(a: Authed, body: Record<string, unknown>): Promise<void> {
    await this.reauth(a, body.authKey)
    await withTx(this.db, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(4244)')
      // The last admin leaving would leave a server nobody can manage.
      if (a.user.is_admin) {
        const r = await c.query<{ admins: number; users: number }>(
          'SELECT COUNT(*) FILTER (WHERE is_admin)::int AS admins, COUNT(*)::int AS users FROM users'
        )
        if (r.rows[0].admins === 1 && r.rows[0].users > 1)
          throw new HttpError(400, 'Kamu admin terakhir; jadikan user lain admin dulu')
      }
      await this.purgeUser(c, a.user.id)
    })
  }

  /** Delete an account and everything it owns: personal vault, owned teams and their vaults. */
  private async purgeUser(c: Tx, userId: string): Promise<void> {
    const owned = await c.query<{ id: string }>('SELECT id FROM teams WHERE owner_id = $1', [
      userId
    ])
    for (const t of owned.rows) await c.query('DELETE FROM records WHERE scope = $1', [`t:${t.id}`])
    await c.query('DELETE FROM records WHERE scope = $1', [`u:${userId}`])
    await c.query('DELETE FROM users WHERE id = $1', [userId])
  }

  // ── admin ───────────────────────────────────────────────────────────────

  private requireAdmin(a: Authed): void {
    if (!a.user.is_admin) throw new HttpError(403, 'Hanya admin server')
  }

  /** Everything the admin screen shows, in one call. Vault contents stay encrypted. */
  async adminOverview(a: Authed): Promise<Record<string, unknown>> {
    this.requireAdmin(a)
    const users = await this.db.query<{ id: string }>(
      `SELECT u.id, u.username, u.is_admin AS "isAdmin", u.created_at AS "createdAt",
         (SELECT COUNT(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
         (SELECT MAX(d.last_seen) FROM devices d WHERE d.user_id = u.id) AS "lastSeen",
         (SELECT COUNT(*)::int FROM records r WHERE r.scope = 'u:' || u.id AND NOT r.deleted) AS records,
         (SELECT COALESCE(SUM(r.size), 0)::bigint FROM records r WHERE r.scope = 'u:' || u.id) AS bytes,
         (SELECT COUNT(*)::int FROM teams t WHERE t.owner_id = u.id) AS "teamsOwned"
       FROM users u ORDER BY lower(u.username)`
    )
    const invites = await this.db.query(
      `SELECT i.id, i.note, i.created_at AS "createdAt", i.expires_at AS "expiresAt",
         i.used_at AS "usedAt", i.used_username AS "usedBy", u.username AS "createdBy"
       FROM invites i LEFT JOIN users u ON u.id = i.created_by
       ORDER BY i.created_at DESC LIMIT 100`
    )
    const setting = await this.signupSetting(this.db)
    return {
      signup: this.effectiveSignup(setting, users.rows.length),
      signupSetting: setting,
      envSignup: this.cfg.signup,
      maxRecords: this.cfg.maxRecords,
      maxBytes: this.cfg.maxBytes,
      users: users.rows.map((u) => ({ ...u, current: u.id === a.user.id })),
      invites: invites.rows
    }
  }

  async setSignup(a: Authed, body: Record<string, unknown>): Promise<void> {
    this.requireAdmin(a)
    if (body.mode === null) {
      await this.db.query("DELETE FROM meta WHERE key = 'signup'")
      return
    }
    if (!SIGNUP_SETTINGS.includes(body.mode as SignupSetting))
      throw new HttpError(400, 'Mode pendaftaran harus open, invite, closed, atau null')
    await this.db.query(
      "INSERT INTO meta(key, value) VALUES('signup', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [body.mode]
    )
  }

  /** The code is returned once; only its hash is stored. */
  async createInvite(
    a: Authed,
    body: Record<string, unknown>
  ): Promise<{ id: string; code: string; expiresAt: number }> {
    this.requireAdmin(a)
    const hours = body.hours === undefined ? 72 : Number(body.hours)
    if (!Number.isInteger(hours) || hours < 1 || hours > 720)
      throw new HttpError(400, 'Masa berlaku undangan 1-720 jam')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 80) : ''
    const now = Date.now()
    const active = await this.db.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM invites WHERE used_at IS NULL AND expires_at > $1',
      [now]
    )
    if (active.rows[0].n >= MAX_ACTIVE_INVITES)
      throw new HttpError(400, `Maksimal ${MAX_ACTIVE_INVITES} undangan aktif`)
    const code = randomBytes(15).toString('base64url')
    const id = randomUUID()
    const expiresAt = now + hours * 3_600_000
    await this.db.query(
      'INSERT INTO invites(id, code_hash, note, created_by, created_at, expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, tokenHash(code), note, a.user.id, now, expiresAt]
    )
    return { id, code, expiresAt }
  }

  async revokeInvite(a: Authed, id: string): Promise<void> {
    this.requireAdmin(a)
    await this.db.query('DELETE FROM invites WHERE id = $1', [uuid(id, 'id')])
  }

  private async targetUser(a: Authed, id: string): Promise<{ id: string; is_admin: boolean }> {
    this.requireAdmin(a)
    const r = await this.db.query<{ id: string; is_admin: boolean }>(
      'SELECT id, is_admin FROM users WHERE id = $1',
      [uuid(id, 'userId')]
    )
    if (!r.rows[0]) throw new HttpError(404, 'User tidak ada')
    return r.rows[0]
  }

  /** Sign a user out everywhere (lost laptop, leaked token). */
  async adminRevokeDevices(a: Authed, id: string): Promise<void> {
    const u = await this.targetUser(a, id)
    // Keep the admin's own current device: the request came from it.
    await this.db.query('DELETE FROM devices WHERE user_id = $1 AND id <> $2', [u.id, a.deviceId])
  }

  async adminDeleteUser(a: Authed, id: string): Promise<void> {
    const u = await this.targetUser(a, id)
    if (u.id === a.user.id)
      throw new HttpError(400, 'Hapus akunmu sendiri lewat pengaturan akun, bukan panel admin')
    await withTx(this.db, (c) => this.purgeUser(c, u.id))
  }

  async adminSetAdmin(a: Authed, id: string, body: Record<string, unknown>): Promise<void> {
    const u = await this.targetUser(a, id)
    if (typeof body.isAdmin !== 'boolean') throw new HttpError(400, 'isAdmin harus boolean')
    if (u.id === a.user.id && !body.isAdmin)
      throw new HttpError(400, 'Kamu tidak bisa mencabut admin dari dirimu sendiri')
    await this.db.query('UPDATE users SET is_admin = $1 WHERE id = $2', [body.isAdmin, u.id])
  }

  async devices(a: Authed): Promise<unknown[]> {
    const r = await this.db.query<{ id: string }>(
      'SELECT id, name, created_at AS "createdAt", last_seen AS "lastSeen" FROM devices WHERE user_id = $1 ORDER BY last_seen DESC',
      [a.user.id]
    )
    return r.rows.map((d) => ({ ...d, current: d.id === a.deviceId }))
  }

  async revokeDevice(a: Authed, id: string): Promise<void> {
    await this.db.query('DELETE FROM devices WHERE id = $1 AND user_id = $2', [
      uuid(id, 'id'),
      a.user.id
    ])
  }

  // ── sync ────────────────────────────────────────────────────────────────

  private async scopesOf(userId: string): Promise<string[]> {
    const teams = await this.db.query<{ team_id: string }>(
      'SELECT team_id FROM team_members WHERE user_id = $1',
      [userId]
    )
    return [`u:${userId}`, ...teams.rows.map((t) => `t:${t.team_id}`)]
  }

  /** `only` limits the pull to one scope, used to backfill a team the user just joined. */
  async pull(
    a: Authed,
    since: number,
    only?: string
  ): Promise<{ records: unknown[]; cursor: number }> {
    let scopes = await this.scopesOf(a.user.id)
    if (only) {
      if (!scopes.includes(only)) throw new HttpError(403, 'Tidak punya akses ke vault ini')
      scopes = [only]
    }
    const r = await this.db.query<{ seq: number }>(
      `SELECT scope, id, updated_at AS "updatedAt", deleted, blob, seq FROM records
       WHERE scope = ANY($1) AND seq > $2 ORDER BY seq LIMIT 5000`,
      [scopes, Math.max(0, Math.floor(since))]
    )
    // Writers hold RECORD_WRITE_LOCK until commit, so rows appear in seq order and
    // "the highest seq we returned" is a cursor that never skips a later commit.
    const cursor = r.rows.length ? r.rows[r.rows.length - 1].seq : since
    return { records: r.rows, cursor }
  }

  async push(
    a: Authed,
    body: Record<string, unknown>
  ): Promise<{ accepted: number; stale: string[] }> {
    const list = body.records
    if (!Array.isArray(list) || list.length > 5000)
      throw new HttpError(400, 'records harus array (maks 5000)')
    const allowed = new Set(await this.scopesOf(a.user.id))
    const rows = (list as Record<string, unknown>[]).map((r) => {
      const scope = str(r.scope, 'scope', 80)
      if (!allowed.has(scope)) throw new HttpError(403, 'Tidak punya akses ke vault ini')
      const id = str(r.id, 'id', 80)
      const updatedAt = Number(r.updatedAt)
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0)
        throw new HttpError(400, 'updatedAt tidak valid')
      const blob = str(r.blob, 'blob', 2 * 1024 * 1024)
      return { scope, id, updatedAt, deleted: !!r.deleted, blob }
    })
    const stale: string[] = []
    let accepted = 0
    await withTx(this.db, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [RECORD_WRITE_LOCK])
      for (const r of rows) {
        // Last writer wins, atomically: the update only happens when the incoming copy is newer.
        const res = await c.query(
          `INSERT INTO records(scope, id, updated_at, deleted, blob, size, seq)
           VALUES($1, $2, $3, $4, $5, $6, nextval('record_seq'))
           ON CONFLICT (scope, id) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted,
             blob = excluded.blob, size = excluded.size, seq = excluded.seq
           WHERE records.updated_at < excluded.updated_at
           RETURNING id`,
          [r.scope, r.id, r.updatedAt, r.deleted, r.blob, r.blob.length]
        )
        if (res.rowCount) accepted++
        else stale.push(r.id)
      }
      // Quota is checked on the result; going over rolls the whole batch back.
      for (const scope of new Set(rows.map((r) => r.scope))) {
        const usage = (
          await c.query<{ n: number; bytes: number }>(
            'SELECT COUNT(*)::int AS n, COALESCE(SUM(size), 0)::bigint AS bytes FROM records WHERE scope = $1',
            [scope]
          )
        ).rows[0]
        if (usage.n > this.cfg.maxRecords || usage.bytes > this.cfg.maxBytes)
          throw new HttpError(507, 'Kuota penyimpanan vault ini di server sudah penuh')
      }
    })
    return { accepted, stale }
  }

  // ── teams ───────────────────────────────────────────────────────────────

  async teamsOf(userId: string): Promise<unknown[]> {
    const r = await this.db.query(
      `SELECT t.id, t.name, t.owner_id AS "ownerId", m.role, m.wrapped_team_key AS "wrappedTeamKey"
       FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY t.name`,
      [userId]
    )
    return r.rows
  }

  async createTeam(a: Authed, body: Record<string, unknown>): Promise<{ id: string }> {
    const name = str(body.name, 'name', 80).trim()
    if (!name) throw new HttpError(400, 'Nama tim tidak boleh kosong')
    const wrapped = box(body.wrappedTeamKey, 'wrappedTeamKey', ['epk', 'nonce', 'ct'])
    const count = await this.db.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM teams WHERE owner_id = $1',
      [a.user.id]
    )
    if (count.rows[0].n >= 50) throw new HttpError(400, 'Maksimal 50 tim per akun')
    const id = randomUUID()
    await withTx(this.db, async (c) => {
      await c.query('INSERT INTO teams(id, name, owner_id, created_at) VALUES($1,$2,$3,$4)', [
        id,
        name,
        a.user.id,
        Date.now()
      ])
      await c.query(
        'INSERT INTO team_members(team_id, user_id, role, wrapped_team_key, added_at) VALUES($1,$2,$3,$4,$5)',
        [id, a.user.id, 'owner', wrapped, Date.now()]
      )
    })
    return { id }
  }

  private async roleIn(a: Authed, teamId: string): Promise<string | undefined> {
    const r = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, a.user.id]
    )
    return r.rows[0]?.role
  }

  private async requireOwner(a: Authed, teamId: string): Promise<void> {
    const role = await this.roleIn(a, uuid(teamId, 'teamId'))
    if (!role) throw new HttpError(404, 'Tim tidak ditemukan')
    if (role !== 'owner') throw new HttpError(403, 'Hanya pemilik tim')
  }

  async members(a: Authed, teamId: string): Promise<unknown[]> {
    if (!(await this.roleIn(a, uuid(teamId, 'teamId'))))
      throw new HttpError(404, 'Tim tidak ditemukan')
    const r = await this.db.query(
      `SELECT u.id AS "userId", u.username, u.public_key AS "publicKey", m.role, m.added_at AS "addedAt"
       FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY u.username`,
      [teamId]
    )
    return r.rows
  }

  async publicKeyOf(
    username: string
  ): Promise<{ userId: string; username: string; publicKey: string }> {
    const r = await this.db.query<{ id: string; username: string; public_key: string }>(
      'SELECT id, username, public_key FROM users WHERE lower(username) = lower($1)',
      [username]
    )
    const u = r.rows[0]
    if (!u) throw new HttpError(404, 'User tidak ada di server ini')
    return { userId: u.id, username: u.username, publicKey: u.public_key }
  }

  async addMember(a: Authed, teamId: string, body: Record<string, unknown>): Promise<void> {
    await this.requireOwner(a, teamId)
    const userId = uuid(body.userId, 'userId')
    const wrapped = box(body.wrappedTeamKey, 'wrappedTeamKey', ['epk', 'nonce', 'ct'])
    const exists = await this.db.query('SELECT 1 FROM users WHERE id = $1', [userId])
    if (!exists.rowCount) throw new HttpError(404, 'User tidak ada')
    const count = await this.db.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1',
      [teamId]
    )
    if (count.rows[0].n >= 200) throw new HttpError(400, 'Maksimal 200 anggota per tim')
    await this.db.query(
      `INSERT INTO team_members(team_id, user_id, role, wrapped_team_key, added_at) VALUES($1,$2,'member',$3,$4)
       ON CONFLICT (team_id, user_id) DO UPDATE SET wrapped_team_key = excluded.wrapped_team_key`,
      [teamId, userId, wrapped, Date.now()]
    )
  }

  async removeMember(a: Authed, teamId: string, userId: string): Promise<void> {
    uuid(teamId, 'teamId')
    uuid(userId, 'userId')
    if (userId !== a.user.id) await this.requireOwner(a, teamId)
    const target = await this.db.query<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    )
    if (target.rows[0]?.role === 'owner')
      throw new HttpError(400, 'Pemilik tidak bisa dikeluarkan; hapus timnya')
    await this.db.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [
      teamId,
      userId
    ])
  }

  async deleteTeam(a: Authed, teamId: string): Promise<void> {
    await this.requireOwner(a, teamId)
    await withTx(this.db, async (c) => {
      await c.query('DELETE FROM records WHERE scope = $1', [`t:${teamId}`])
      await c.query('DELETE FROM teams WHERE id = $1', [teamId])
    })
  }
}
