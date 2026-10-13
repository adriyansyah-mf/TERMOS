import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fakeKdf, hashAuthKey, Limiter, newToken, tokenHash, verifyAuthKey } from './auth.ts'
import { nextSeq, tx, type DB } from './db.ts'

export interface Config {
  /** 'first' (default): only the first account may self-register; 'open': anyone; 'invite': needs inviteCode. */
  signup: 'first' | 'open' | 'invite'
  inviteCode?: string
  /** Secret for fake prelogin answers; generated once and kept in the DB. */
  secret: string
}

interface UserRow {
  id: string
  username: string
  auth_hash: string
  auth_salt: string
  kdf: string
  wrapped_key: string
  public_key: string
  wrapped_private_key: string
  is_admin: number
}

interface Authed {
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
const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/

function str(v: unknown, name: string, max = 20000): string {
  if (typeof v !== 'string' || !v || v.length > max) throw new HttpError(400, `Field "${name}" tidak valid`)
  return v
}

function json(v: unknown, name: string): string {
  if (!v || typeof v !== 'object') throw new HttpError(400, `Field "${name}" tidak valid`)
  return JSON.stringify(v)
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Request terlalu besar')
    chunks.push(c as Buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Body bukan JSON')
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  res.end(text)
}

export function loadSecret(db: DB): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'secret'").get() as { value: string } | undefined
  if (row) return row.value
  const secret = randomBytes(32).toString('base64')
  db.prepare("INSERT INTO meta(key, value) VALUES('secret', ?)").run(secret)
  return secret
}

export class App {
  private db: DB
  private cfg: Config
  private loginLimit = new Limiter(10, 15 * 60 * 1000)

  constructor(db: DB, cfg: Config) {
    this.db = db
    this.cfg = cfg
  }

  // ── auth ────────────────────────────────────────────────────────────────

  authenticate(header: string | undefined): Authed {
    const m = /^Bearer (.+)$/.exec(header ?? '')
    if (!m) throw new HttpError(401, 'Belum login')
    const dev = this.db
      .prepare('SELECT id, user_id FROM devices WHERE token_hash = ?')
      .get(tokenHash(m[1])) as { id: string; user_id: string } | undefined
    if (!dev) throw new HttpError(401, 'Sesi tidak berlaku, login lagi')
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(dev.user_id) as unknown as UserRow
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), dev.id)
    return { user, deviceId: dev.id }
  }

  status(): { signup: string; users: number } {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    const signup = this.cfg.signup === 'first' ? (n === 0 ? 'open' : 'closed') : this.cfg.signup
    return { signup, users: n }
  }

  prelogin(body: Record<string, unknown>): { kdf: unknown } {
    const username = str(body.username, 'username', 64)
    const row = this.db.prepare('SELECT kdf FROM users WHERE username = ?').get(username) as
      | { kdf: string }
      | undefined
    return { kdf: row ? JSON.parse(row.kdf) : fakeKdf(this.cfg.secret, username) }
  }

  private issueDevice(userId: string, deviceName: unknown): { token: string; deviceId: string } {
    const { token, hash } = newToken()
    const deviceId = randomUUID()
    const now = Date.now()
    this.db
      .prepare('INSERT INTO devices(id, user_id, name, token_hash, created_at, last_seen) VALUES(?,?,?,?,?,?)')
      .run(deviceId, userId, typeof deviceName === 'string' ? deviceName.slice(0, 80) : 'Perangkat', hash, now, now)
    return { token, deviceId }
  }

  register(body: Record<string, unknown>): Record<string, unknown> {
    const username = str(body.username, 'username', 40)
    if (!USERNAME.test(username))
      throw new HttpError(400, 'Username 3-40 karakter: huruf, angka, titik, minus, garis bawah')
    const authKey = str(body.authKey, 'authKey', 200)
    const kdf = json(body.kdf, 'kdf')
    const wrappedKey = json(body.wrappedKey, 'wrappedKey')
    const publicKey = str(body.publicKey, 'publicKey', 200)
    const wrappedPrivateKey = json(body.wrappedPrivateKey, 'wrappedPrivateKey')

    return tx(this.db, () => {
      const n = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
      const mode = this.cfg.signup
      if (mode === 'first' && n > 0)
        throw new HttpError(403, 'Pendaftaran ditutup. Minta admin server membuatkan akun.')
      if (mode === 'invite' && body.inviteCode !== this.cfg.inviteCode)
        throw new HttpError(403, 'Kode undangan salah')
      if (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
        throw new HttpError(409, 'Username sudah dipakai')
      const id = randomUUID()
      const { hash, salt } = hashAuthKey(authKey)
      this.db
        .prepare(
          `INSERT INTO users(id, username, auth_hash, auth_salt, kdf, wrapped_key, public_key, wrapped_private_key, is_admin, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`
        )
        .run(id, username, hash, salt, kdf, wrappedKey, publicKey, wrappedPrivateKey, n === 0 ? 1 : 0, Date.now())
      const { token, deviceId } = this.issueDevice(id, body.deviceName)
      return { userId: id, token, deviceId, isAdmin: n === 0 }
    })
  }

  login(body: Record<string, unknown>, ip: string): Record<string, unknown> {
    const username = str(body.username, 'username', 64)
    const authKey = str(body.authKey, 'authKey', 200)
    const key = `${ip}|${username.toLowerCase()}`
    if (this.loginLimit.blocked(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.')
    const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
    if (!user || !verifyAuthKey(authKey, user.auth_hash, user.auth_salt)) {
      this.loginLimit.fail(key)
      throw new HttpError(401, 'Username atau password salah')
    }
    this.loginLimit.reset(key)
    const { token, deviceId } = this.issueDevice(user.id, body.deviceName)
    return {
      token,
      deviceId,
      ...this.profile(user)
    }
  }

  private profile(user: UserRow): Record<string, unknown> {
    return {
      userId: user.id,
      username: user.username,
      isAdmin: !!user.is_admin,
      kdf: JSON.parse(user.kdf),
      wrappedKey: JSON.parse(user.wrapped_key),
      publicKey: user.public_key,
      wrappedPrivateKey: JSON.parse(user.wrapped_private_key),
      teams: this.teamsOf(user.id)
    }
  }

  me(a: Authed): Record<string, unknown> {
    return this.profile(a.user)
  }

  logout(a: Authed): void {
    this.db.prepare('DELETE FROM devices WHERE id = ?').run(a.deviceId)
  }

  changePassword(a: Authed, body: Record<string, unknown>): void {
    const oldKey = str(body.authKey, 'authKey', 200)
    if (!verifyAuthKey(oldKey, a.user.auth_hash, a.user.auth_salt)) throw new HttpError(403, 'Password lama salah')
    const { hash, salt } = hashAuthKey(str(body.newAuthKey, 'newAuthKey', 200))
    tx(this.db, () => {
      this.db
        .prepare('UPDATE users SET auth_hash = ?, auth_salt = ?, kdf = ?, wrapped_key = ?, wrapped_private_key = ? WHERE id = ?')
        .run(hash, salt, json(body.kdf, 'kdf'), json(body.wrappedKey, 'wrappedKey'), json(body.wrappedPrivateKey, 'wrappedPrivateKey'), a.user.id)
      // Every other device must log in again with the new password.
      this.db.prepare('DELETE FROM devices WHERE user_id = ? AND id != ?').run(a.user.id, a.deviceId)
    })
  }

  devices(a: Authed): unknown[] {
    return (
      this.db
        .prepare('SELECT id, name, created_at AS createdAt, last_seen AS lastSeen FROM devices WHERE user_id = ? ORDER BY last_seen DESC')
        .all(a.user.id) as { id: string }[]
    ).map((d) => ({ ...d, current: d.id === a.deviceId }))
  }

  revokeDevice(a: Authed, id: string): void {
    this.db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(id, a.user.id)
  }

  // ── admin: create accounts when public signup is closed ─────────────────

  createInvite(a: Authed): { inviteCode: string } {
    if (!a.user.is_admin) throw new HttpError(403, 'Hanya admin')
    if (this.cfg.signup !== 'invite')
      throw new HttpError(400, 'Server tidak dalam mode undangan (TERMOS_SIGNUP=invite)')
    return { inviteCode: this.cfg.inviteCode ?? '' }
  }

  // ── sync ────────────────────────────────────────────────────────────────

  private scopesOf(userId: string): string[] {
    const teams = this.db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(userId) as {
      team_id: string
    }[]
    return [`u:${userId}`, ...teams.map((t) => `t:${t.team_id}`)]
  }

  /** `only` limits the pull to one scope, used to backfill a team the user just joined. */
  pull(a: Authed, since: number, only?: string): { records: unknown[]; cursor: number } {
    let scopes = this.scopesOf(a.user.id)
    if (only) {
      if (!scopes.includes(only)) throw new HttpError(403, `Tidak punya akses ke ${only}`)
      scopes = [only]
    }
    const placeholders = scopes.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT scope, id, updated_at AS updatedAt, deleted, blob, seq FROM records
         WHERE scope IN (${placeholders}) AND seq > ? ORDER BY seq LIMIT 5000`
      )
      .all(...scopes, since) as { seq: number; deleted: number }[]
    const cursorRow = this.db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value: string } | undefined
    const cursor = rows.length === 5000 ? rows[rows.length - 1].seq : Number(cursorRow?.value ?? 0)
    return {
      records: rows.map((r) => ({ ...r, deleted: !!r.deleted })),
      cursor
    }
  }

  push(a: Authed, body: Record<string, unknown>): { accepted: number; stale: string[]; cursor: number } {
    const list = body.records
    if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, 'records harus array (maks 5000)')
    const allowed = new Set(this.scopesOf(a.user.id))
    const stale: string[] = []
    let accepted = 0
    tx(this.db, () => {
      const get = this.db.prepare('SELECT updated_at FROM records WHERE scope = ? AND id = ?')
      const put = this.db.prepare(
        `INSERT INTO records(scope, id, updated_at, deleted, blob, seq) VALUES(?,?,?,?,?,?)
         ON CONFLICT(scope, id) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted,
         blob = excluded.blob, seq = excluded.seq`
      )
      for (const r of list as Record<string, unknown>[]) {
        const scope = str(r.scope, 'scope', 80)
        if (!allowed.has(scope)) throw new HttpError(403, `Tidak punya akses ke ${scope}`)
        const id = str(r.id, 'id', 80)
        const updatedAt = Number(r.updatedAt)
        if (!Number.isFinite(updatedAt)) throw new HttpError(400, 'updatedAt tidak valid')
        const blob = str(r.blob, 'blob', 4 * 1024 * 1024)
        const cur = get.get(scope, id) as { updated_at: number } | undefined
        // Last writer wins; an older write is reported back so the client re-pulls.
        if (cur && cur.updated_at >= updatedAt) {
          stale.push(id)
          continue
        }
        put.run(scope, id, updatedAt, r.deleted ? 1 : 0, blob, nextSeq(this.db))
        accepted++
      }
    })
    const cursorRow = this.db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value: string } | undefined
    return { accepted, stale, cursor: Number(cursorRow?.value ?? 0) }
  }

  // ── teams ───────────────────────────────────────────────────────────────

  teamsOf(userId: string): unknown[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.owner_id AS ownerId, m.role, m.wrapped_team_key AS wrappedTeamKey
         FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name`
      )
      .all(userId)
      .map((r) => {
        const row = r as Record<string, unknown>
        return { ...row, wrappedTeamKey: JSON.parse(row.wrappedTeamKey as string) }
      })
  }

  createTeam(a: Authed, body: Record<string, unknown>): { id: string } {
    const name = str(body.name, 'name', 80)
    const wrapped = json(body.wrappedTeamKey, 'wrappedTeamKey')
    const id = randomUUID()
    tx(this.db, () => {
      this.db.prepare('INSERT INTO teams(id, name, owner_id, created_at) VALUES(?,?,?,?)').run(id, name, a.user.id, Date.now())
      this.db
        .prepare('INSERT INTO team_members(team_id, user_id, role, wrapped_team_key, added_at) VALUES(?,?,?,?,?)')
        .run(id, a.user.id, 'owner', wrapped, Date.now())
    })
    return { id }
  }

  private requireOwner(a: Authed, teamId: string): void {
    const m = this.db
      .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(teamId, a.user.id) as { role: string } | undefined
    if (!m) throw new HttpError(404, 'Tim tidak ditemukan')
    if (m.role !== 'owner') throw new HttpError(403, 'Hanya pemilik tim')
  }

  members(a: Authed, teamId: string): unknown[] {
    const me = this.db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, a.user.id)
    if (!me) throw new HttpError(404, 'Tim tidak ditemukan')
    return this.db
      .prepare(
        `SELECT u.id AS userId, u.username, m.role, m.added_at AS addedAt FROM team_members m
         JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY u.username`
      )
      .all(teamId)
  }

  publicKeyOf(username: string): { userId: string; username: string; publicKey: string } {
    const u = this.db.prepare('SELECT id, username, public_key FROM users WHERE username = ?').get(username) as
      | { id: string; username: string; public_key: string }
      | undefined
    if (!u) throw new HttpError(404, `User "${username}" tidak ada di server ini`)
    return { userId: u.id, username: u.username, publicKey: u.public_key }
  }

  addMember(a: Authed, teamId: string, body: Record<string, unknown>): void {
    this.requireOwner(a, teamId)
    const userId = str(body.userId, 'userId', 80)
    const wrapped = json(body.wrappedTeamKey, 'wrappedTeamKey')
    if (!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(404, 'User tidak ada')
    this.db
      .prepare(
        `INSERT INTO team_members(team_id, user_id, role, wrapped_team_key, added_at) VALUES(?,?,?,?,?)
         ON CONFLICT(team_id, user_id) DO UPDATE SET wrapped_team_key = excluded.wrapped_team_key`
      )
      .run(teamId, userId, 'member', wrapped, Date.now())
  }

  removeMember(a: Authed, teamId: string, userId: string): void {
    if (userId !== a.user.id) this.requireOwner(a, teamId)
    const target = this.db
      .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(teamId, userId) as { role: string } | undefined
    if (target?.role === 'owner') throw new HttpError(400, 'Pemilik tidak bisa dikeluarkan; hapus timnya')
    this.db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId)
  }

  deleteTeam(a: Authed, teamId: string): void {
    this.requireOwner(a, teamId)
    tx(this.db, () => {
      this.db.prepare('DELETE FROM records WHERE scope = ?').run(`t:${teamId}`)
      this.db.prepare('DELETE FROM teams WHERE id = ?').run(teamId)
    })
  }
}
