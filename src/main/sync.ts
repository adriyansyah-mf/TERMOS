import { EventEmitter } from 'node:events'
import { hostname } from 'node:os'
import {
  SYNCED_COLLECTIONS,
  type CollectionName,
  type Entity,
  type TeamVault
} from '../shared/types'
import { b64, open, seal, unb64, type SealedBox } from './crypto'
import { fmt, tr } from './i18n'
import {
  deriveAccountKeys,
  keyFingerprint,
  newAccountKdf,
  newKeyPair,
  openSealed,
  randomKey,
  sealTo,
  unwrap,
  wrap,
  type AccountKdf,
  type SealedToKey
} from './syncCrypto'
import { vault } from './vault'

const S = {
  id: {
    httpsRequired:
      'Server di internet harus memakai https://. http:// hanya untuk localhost atau jaringan lokal.',
    unreachable: 'Server tidak bisa dihubungi (%s)',
    sessionEnded: 'Sesi sync berakhir (perangkat dicabut atau password diganti). Login lagi.',
    notLoggedIn: 'Belum login',
    httpStatus: 'HTTP %s',
    passwordMinLength: 'Password akun minimal 10 karakter',
    deviceName: 'Termos di %s',
    fingerprintChanged: 'Fingerprint kunci berubah sejak dicek. Anggota tidak ditambahkan.',
    teamNotFound: 'Tim tidak ditemukan'
  },
  en: {
    httpsRequired:
      'Servers on the internet must use https://. http:// is only for localhost or a local network.',
    unreachable: 'Cannot reach the server (%s)',
    sessionEnded: 'Sync session ended (device revoked or password changed). Log in again.',
    notLoggedIn: 'Not logged in',
    httpStatus: 'HTTP %s',
    passwordMinLength: 'Account password must be at least 10 characters',
    deviceName: 'Termos on %s',
    fingerprintChanged: 'The key fingerprint changed since you checked it. Member not added.',
    teamNotFound: 'Team not found'
  }
}

export interface SyncStatus {
  connected: boolean
  serverUrl: string
  username?: string
  isAdmin?: boolean
  lastSyncAt?: number
  lastError?: string
  syncing: boolean
  fingerprint?: string
  teams: { id: string; label: string; role?: string }[]
}

export interface Device {
  id: string
  name: string
  createdAt: number
  lastSeen: number
  current: boolean
}

interface RemoteRecord {
  scope: string
  id: string
  updatedAt: number
  deleted: boolean
  blob: string
  seq: number
}

interface RemoteTeam {
  id: string
  name: string
  role: 'owner' | 'member'
  wrappedTeamKey: SealedToKey
}

/** Payload inside every encrypted record. The collection name stays hidden from the server. */
interface Payload {
  c: CollectionName
  e: Entity | null
}

/** A literal private IPv4 address. Anchored at both ends: `10.evil.com` is a public name. */
function isPrivateV4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((x) => Number(x) > 255)) return false
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  )
}

/** Associated data that pins a record's ciphertext to where and when it was written. */
function recordAad(scope: string, id: string, updatedAt: number, deleted: boolean): string {
  return `termos-record-v1|${scope}|${id}|${updatedAt}|${deleted ? 1 : 0}`
}

/** HTTPS everywhere, except localhost and private LAN addresses (self-hosted on a home network). */
export function normalizeServerUrl(input: string): string {
  let raw = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  const u = new URL(raw)
  if (u.protocol === 'http:') {
    const h = u.hostname
    const local =
      h === 'localhost' ||
      h === '[::1]' ||
      isPrivateV4(h) ||
      h.endsWith('.local') ||
      h.endsWith('.lan')
    if (!local) throw new Error(tr(S).httpsRequired)
  }
  return u.toString().replace(/\/+$/, '')
}

class SyncService extends EventEmitter {
  private syncing = false
  private again = false
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null

  // ── HTTP ──────────────────────────────────────────────────────────────

  private async call<T>(method: string, path: string, body?: unknown, base?: string): Promise<T> {
    const s = vault.get().settings.sync
    const url = (base ?? s.serverUrl) + '/api' + path
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(s.token && !base ? { Authorization: `Bearer ${s.token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      })
    } catch (err) {
      throw new Error(fmt(tr(S).unreachable, (err as Error).message))
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.status === 401 && !base) {
      this.forgetAccount(tr(S).sessionEnded)
      throw new Error(data.error ?? tr(S).notLoggedIn)
    }
    if (!res.ok) throw new Error(data.error ?? fmt(tr(S).httpStatus, String(res.status)))
    return data as T
  }

  // ── account ───────────────────────────────────────────────────────────

  status(): SyncStatus {
    const s = vault.get().settings.sync
    return {
      connected: !!s.token,
      serverUrl: s.serverUrl,
      username: s.username,
      isAdmin: s.isAdmin,
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
      syncing: this.syncing,
      fingerprint: s.publicKey ? keyFingerprint(s.publicKey) : undefined,
      teams: vault.get().teams.map((t) => ({ id: t.id, label: t.label, role: t.role }))
    }
  }

  async serverInfo(serverUrl: string): Promise<{ signup: string; users: number; version: string }> {
    return this.call('GET', '/status', undefined, normalizeServerUrl(serverUrl))
  }

  async register(
    serverUrl: string,
    username: string,
    password: string,
    inviteCode?: string
  ): Promise<void> {
    if (password.length < 10) throw new Error(tr(S).passwordMinLength)
    const base = normalizeServerUrl(serverUrl)
    const kdf = newAccountKdf()
    const { authKey, encKey } = await deriveAccountKeys(password, kdf)
    const syncKey = randomKey()
    const pair = newKeyPair()
    const r = await this.call<{ token: string; userId: string; isAdmin: boolean }>(
      'POST',
      '/register',
      {
        username,
        authKey,
        kdf,
        wrappedKey: wrap(encKey, syncKey, 'syncKey'),
        publicKey: pair.publicKey,
        wrappedPrivateKey: wrap(encKey, pair.privateKey, 'privateKey'),
        deviceName: fmt(tr(S).deviceName, hostname()),
        inviteCode: inviteCode || undefined
      },
      base
    )
    this.adoptAccount(
      base,
      username,
      r.token,
      r.userId,
      r.isAdmin,
      syncKey,
      pair.publicKey,
      pair.privateKey
    )
    await this.syncNow()
  }

  async login(serverUrl: string, username: string, password: string): Promise<void> {
    const base = normalizeServerUrl(serverUrl)
    const pre = await this.call<{ kdf: AccountKdf }>('POST', '/prelogin', { username }, base)
    const { authKey, encKey } = await deriveAccountKeys(password, pre.kdf)
    const r = await this.call<{
      token: string
      userId: string
      username: string
      isAdmin: boolean
      wrappedKey: SealedBox
      publicKey: string
      wrappedPrivateKey: SealedBox
    }>('POST', '/login', { username, authKey, deviceName: fmt(tr(S).deviceName, hostname()) }, base)
    const syncKey = unwrap(encKey, r.wrappedKey, 'syncKey')
    const privateKey = unwrap(encKey, r.wrappedPrivateKey, 'privateKey')
    this.adoptAccount(
      base,
      r.username,
      r.token,
      r.userId,
      r.isAdmin,
      syncKey,
      r.publicKey,
      privateKey
    )
    await this.syncNow()
  }

  private adoptAccount(
    serverUrl: string,
    username: string,
    token: string,
    userId: string,
    isAdmin: boolean,
    syncKey: Uint8Array,
    publicKey: string,
    privateKey: Uint8Array
  ): void {
    const d = vault.get()
    // A different account or server means previous bookkeeping no longer applies.
    if (d.settings.sync.userId !== userId || d.settings.sync.serverUrl !== serverUrl)
      d.syncState = {}
    vault.setSync({
      enabled: true,
      serverUrl,
      username,
      token,
      userId,
      isAdmin,
      cursor: 0,
      syncKey: b64(syncKey),
      publicKey,
      privateKey: b64(privateKey),
      lastError: undefined
    })
    this.start()
  }

  async logout(): Promise<void> {
    try {
      await this.call('POST', '/logout')
    } catch {
      /* server unreachable; forget locally anyway */
    }
    this.forgetAccount()
  }

  private forgetAccount(reason?: string): void {
    this.stop()
    const d = vault.get()
    for (const t of [...d.teams]) vault.purgeTeam(t.id)
    d.syncState = {}
    vault.setSync({
      enabled: false,
      token: '',
      cursor: 0,
      syncKey: undefined,
      privateKey: undefined,
      publicKey: undefined,
      userId: undefined,
      isAdmin: undefined,
      lastError: reason
    })
    this.emit('status', this.status())
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 10) throw new Error(tr(S).passwordMinLength)
    const s = vault.get().settings.sync
    const pre = await this.call<{ kdf: AccountKdf }>('POST', '/prelogin', { username: s.username })
    const old = await deriveAccountKeys(oldPassword, pre.kdf)
    const kdf = newAccountKdf()
    const next = await deriveAccountKeys(newPassword, kdf)
    await this.call('POST', '/password', {
      authKey: old.authKey,
      newAuthKey: next.authKey,
      kdf,
      wrappedKey: wrap(next.encKey, unb64(s.syncKey!), 'syncKey'),
      wrappedPrivateKey: wrap(next.encKey, unb64(s.privateKey!), 'privateKey')
    })
  }

  devices(): Promise<Device[]> {
    return this.call('GET', '/devices')
  }

  revokeDevice(id: string): Promise<void> {
    return this.call('DELETE', `/devices/${encodeURIComponent(id)}`)
  }

  // ── teams ─────────────────────────────────────────────────────────────

  async createTeam(name: string): Promise<void> {
    name = name.trim()
    const s = vault.get().settings.sync
    const key = randomKey()
    const r = await this.call<{ id: string }>('POST', '/teams', {
      name,
      wrappedTeamKey: sealTo(s.publicKey!, key)
    })
    vault.get().teams.push({ id: r.id, label: name, key: b64(key), role: 'owner' })
    vault.changed()
    this.emit('status', this.status())
  }

  /** Step 1 of adding a member: show their key fingerprint so it can be checked out-of-band. */
  async previewMember(username: string): Promise<{ username: string; fingerprint: string }> {
    const u = await this.call<{ username: string; publicKey: string }>(
      'GET',
      `/users/${encodeURIComponent(username)}/key`
    )
    return { username: u.username, fingerprint: keyFingerprint(u.publicKey) }
  }

  /**
   * Step 2: seal the team key to the member, but only if the server still hands out
   * the key whose fingerprint the user confirmed.
   */
  async addMember(teamId: string, username: string, expectedFingerprint: string): Promise<void> {
    const team = this.team(teamId)
    const u = await this.call<{ userId: string; publicKey: string }>(
      'GET',
      `/users/${encodeURIComponent(username)}/key`
    )
    if (keyFingerprint(u.publicKey) !== expectedFingerprint)
      throw new Error(tr(S).fingerprintChanged)
    await this.call('POST', `/teams/${teamId}/members`, {
      userId: u.userId,
      wrappedTeamKey: sealTo(u.publicKey, unb64(team.key))
    })
  }

  async members(
    teamId: string
  ): Promise<{ userId: string; username: string; role: string; fingerprint: string }[]> {
    const list = await this.call<
      { userId: string; username: string; role: string; publicKey: string }[]
    >('GET', `/teams/${teamId}/members`)
    return list.map(({ publicKey, ...m }) => ({ ...m, fingerprint: keyFingerprint(publicKey) }))
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.call('DELETE', `/teams/${teamId}/members/${userId}`)
    if (userId === vault.get().settings.sync.userId) {
      vault.purgeTeam(teamId)
      this.emit('status', this.status())
    }
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.call('DELETE', `/teams/${teamId}`)
    vault.purgeTeam(teamId)
    this.emit('status', this.status())
  }

  private team(teamId: string): TeamVault {
    const t = vault.get().teams.find((x) => x.id === teamId)
    if (!t) throw new Error(tr(S).teamNotFound)
    return t
  }

  /** Learn about teams we were added to or removed from; returns newly joined team ids. */
  private async refreshTeams(): Promise<string[]> {
    const s = vault.get().settings.sync
    const me = await this.call<{ teams: RemoteTeam[]; isAdmin: boolean }>('GET', '/me')
    const d = vault.get()
    const joined: string[] = []
    const priv = unb64(s.privateKey!)
    for (const rt of me.teams) {
      const local = d.teams.find((t) => t.id === rt.id)
      if (local) {
        local.label = rt.name
        local.role = rt.role
        continue
      }
      let key: Uint8Array
      try {
        key = openSealed(priv, rt.wrappedTeamKey)
      } catch {
        continue // sealed to a different key; skip this team instead of failing the whole sync
      }
      d.teams.push({ id: rt.id, label: rt.name, key: b64(key), role: rt.role })
      joined.push(rt.id)
    }
    for (const t of [...d.teams]) if (!me.teams.some((rt) => rt.id === t.id)) vault.purgeTeam(t.id)
    if (me.isAdmin !== s.isAdmin) vault.setSync({ isAdmin: me.isAdmin })
    return joined
  }

  // ── sync ──────────────────────────────────────────────────────────────

  private keyForScope(scope: string): Uint8Array | null {
    const d = vault.get()
    if (scope === `u:${d.settings.sync.userId}`) return unb64(d.settings.sync.syncKey!)
    const team = d.teams.find((t) => `t:${t.id}` === scope)
    return team ? unb64(team.key) : null
  }

  private scopeOf(e: Entity): string | null {
    const d = vault.get()
    if (!e.teamId) return `u:${d.settings.sync.userId}`
    return d.teams.some((t) => t.id === e.teamId) ? `t:${e.teamId}` : null
  }

  private apply(records: RemoteRecord[]): number {
    const d = vault.get()
    let applied = 0
    for (const r of records) {
      const key = this.keyForScope(r.scope)
      if (!key) continue
      let payload: Payload
      try {
        // The AAD makes the server unable to move a record, change its timestamp or flip its deleted flag.
        payload = JSON.parse(
          open(key, JSON.parse(r.blob), recordAad(r.scope, r.id, r.updatedAt, r.deleted))
        )
      } catch {
        continue // tampered, or written with a key we do not have
      }
      if (!payload || !SYNCED_COLLECTIONS.includes(payload.c)) continue
      if (!r.deleted && (!payload.e || typeof payload.e !== 'object')) continue
      const local = (d[payload.c] as Entity[]).find((e) => e.id === r.id)
      if (local && local.updatedAt >= r.updatedAt) {
        // The server already holds exactly our version (e.g. a push whose reply was lost):
        // remember that, or push() would resend it on every sync forever.
        if (local.updatedAt === r.updatedAt && this.scopeOf(local) === r.scope)
          d.syncState[r.id] = { t: r.updatedAt, s: r.scope }
        continue
      }
      // Where a record lives is decided by its scope, never by what the payload claims.
      const teamId = r.scope.startsWith('t:') ? r.scope.slice(2) : undefined
      const entity: Entity =
        r.deleted || !payload.e
          ? { id: r.id, updatedAt: r.updatedAt, deleted: true, teamId: local?.teamId }
          : { ...payload.e, id: r.id, updatedAt: r.updatedAt, teamId }
      // A tombstone from a scope the entity has since left must not delete it.
      if (r.deleted && local && !local.deleted && this.scopeOf(local) !== r.scope) continue
      vault.applyRemote(payload.c, entity)
      d.syncState[r.id] = { t: r.updatedAt, s: r.scope }
      applied++
    }
    return applied
  }

  private async pull(since: number, scope?: string): Promise<number> {
    let cursor = since
    for (;;) {
      const q = `/sync?since=${cursor}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`
      const r = await this.call<{ records: RemoteRecord[]; cursor: number }>('GET', q)
      // Persist and refresh the UI; `syncing` is set, so this does not schedule another sync.
      if (this.apply(r.records) > 0) vault.changed()
      if (r.records.length < 5000 || r.cursor <= cursor) return r.cursor
      cursor = r.cursor
    }
  }

  private async push(): Promise<void> {
    const d = vault.get()
    const out: { scope: string; id: string; updatedAt: number; deleted: boolean; blob: string }[] =
      []
    const pending: { id: string; t: number; s: string }[] = []
    for (const c of SYNCED_COLLECTIONS) {
      for (const e of d[c] as Entity[]) {
        const scope = this.scopeOf(e)
        if (!scope) continue
        const prev = d.syncState[e.id]
        if (prev && prev.t >= e.updatedAt && prev.s === scope) continue
        const key = this.keyForScope(scope)!
        const payload: Payload = { c, e: e.deleted ? null : e }
        out.push({
          scope,
          id: e.id,
          updatedAt: e.updatedAt,
          deleted: !!e.deleted,
          blob: JSON.stringify(
            seal(key, JSON.stringify(payload), recordAad(scope, e.id, e.updatedAt, !!e.deleted))
          )
        })
        pending.push({ id: e.id, t: e.updatedAt, s: scope })
        // Moved between personal and team vault: retire the copy in the old scope.
        if (prev && prev.s !== scope) {
          const oldKey = this.keyForScope(prev.s)
          if (oldKey)
            out.push({
              scope: prev.s,
              id: e.id,
              updatedAt: e.updatedAt - 1,
              deleted: true,
              blob: JSON.stringify(
                seal(
                  oldKey,
                  JSON.stringify({ c, e: null } satisfies Payload),
                  recordAad(prev.s, e.id, e.updatedAt - 1, true)
                )
              )
            })
        }
      }
    }
    for (let i = 0; i < out.length; i += 1000) {
      const batch = out.slice(i, i + 1000)
      const r = await this.call<{ stale: string[] }>('POST', '/sync', { records: batch })
      const stale = new Set(r.stale)
      for (const p of pending)
        if (batch.some((b) => b.id === p.id && b.scope === p.s) && !stale.has(p.id))
          d.syncState[p.id] = { t: p.t, s: p.s }
    }
  }

  async syncNow(): Promise<void> {
    if (!vault.isUnlocked() || !vault.get().settings.sync.token) return
    if (this.syncing) {
      this.again = true
      return
    }
    this.syncing = true
    this.emit('status', this.status())
    try {
      const joined = await this.refreshTeams()
      for (const id of joined) await this.pull(0, `t:${id}`)
      const cursor = await this.pull(vault.get().settings.sync.cursor ?? 0)
      await this.push()
      // Our own pushes advanced the server counter; pull once more so the cursor covers them.
      const after = await this.pull(cursor)
      vault.setSync({ cursor: after, lastSyncAt: Date.now(), lastError: undefined })
    } catch (err) {
      if (vault.isUnlocked() && vault.get().settings.sync.token)
        vault.setSync({ lastError: (err as Error).message })
    } finally {
      this.syncing = false
      this.emit('status', this.status())
      if (this.again) {
        this.again = false
        void this.syncNow()
      }
    }
  }

  /** Called on unlock and after login: periodic sync plus a debounced sync after local edits. */
  start(): void {
    this.stop()
    if (!vault.get().settings.sync.token) return
    this.timer = setInterval(() => void this.syncNow(), 60_000)
    void this.syncNow()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.timer = null
    this.debounce = null
  }

  localChanged(): void {
    if (!this.timer || this.syncing) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.syncNow(), 2000)
  }
}

export const sync = new SyncService()
