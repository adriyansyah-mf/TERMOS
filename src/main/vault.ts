import { app, safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COLLECTIONS,
  DEFAULT_SETTINGS,
  emptyVault,
  type CollectionName,
  type Entity,
  type Settings,
  type VaultData
} from '../shared/types'
import {
  b64,
  deriveKey,
  newKdfParams,
  open,
  seal,
  unb64,
  type KdfParams,
  type SealedBox
} from './crypto'

interface VaultFile extends SealedBox {
  format: 'termos-vault'
  v: 1
  kdf: KdfParams
}

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

class Vault extends EventEmitter {
  private key: Uint8Array | null = null
  private kdf: KdfParams | null = null
  private data: VaultData | null = null
  private saveTimer: NodeJS.Timeout | null = null

  private get file(): string {
    return join(dataDir(), 'vault.json')
  }

  private get quickFile(): string {
    return join(dataDir(), 'quick-unlock.bin')
  }

  exists(): boolean {
    return existsSync(this.file)
  }

  isUnlocked(): boolean {
    return this.data !== null
  }

  quickUnlockAvailable(): boolean {
    return existsSync(this.quickFile) && safeStorage.isEncryptionAvailable()
  }

  async create(password: string): Promise<void> {
    if (this.exists()) throw new Error('Vault sudah ada')
    this.kdf = newKdfParams()
    this.key = await deriveKey(password, this.kdf)
    this.data = emptyVault()
    this.flush()
  }

  async unlock(password: string): Promise<void> {
    const raw = JSON.parse(readFileSync(this.file, 'utf8')) as VaultFile
    const key = await deriveKey(password, raw.kdf)
    let text: string
    try {
      text = open(key, raw)
    } catch {
      throw new Error('Master password salah')
    }
    this.kdf = raw.kdf
    this.key = key
    this.data = this.normalize(JSON.parse(text))
  }

  /** Unlock with the key cached in the OS keychain (libsecret/Keychain/DPAPI). */
  quickUnlock(): void {
    const raw = JSON.parse(readFileSync(this.file, 'utf8')) as VaultFile
    const key = unb64(safeStorage.decryptString(readFileSync(this.quickFile)))
    this.kdf = raw.kdf
    this.key = key
    this.data = this.normalize(JSON.parse(open(key, raw)))
  }

  setQuickUnlock(enabled: boolean): void {
    if (!enabled) {
      rmSync(this.quickFile, { force: true })
      return
    }
    if (!this.key) throw new Error('Vault terkunci')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain OS tidak tersedia')
    writeFileSync(this.quickFile, safeStorage.encryptString(b64(this.key)), { mode: 0o600 })
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.kdf || !this.data) throw new Error('Vault terkunci')
    const check = await deriveKey(oldPassword, this.kdf)
    if (b64(check) !== b64(this.key!)) throw new Error('Password lama salah')
    this.kdf = newKdfParams()
    this.key = await deriveKey(newPassword, this.kdf)
    this.flush()
    if (existsSync(this.quickFile)) this.setQuickUnlock(true)
  }

  lock(): void {
    this.flush()
    this.key = null
    this.data = null
    this.emit('locked')
  }

  get(): VaultData {
    if (!this.data) throw new Error('Vault terkunci')
    return this.data
  }

  /** Data for the renderer: tombstones stripped. */
  snapshot(): VaultData {
    const d = this.get()
    const out = { ...d } as VaultData
    for (const c of COLLECTIONS) (out[c] as Entity[]) = (d[c] as Entity[]).filter((e) => !e.deleted)
    return out
  }

  list<T extends Entity>(c: CollectionName): T[] {
    return (this.get()[c] as unknown as T[]).filter((e) => !e.deleted)
  }

  find<T extends Entity>(c: CollectionName, id: string | undefined): T | undefined {
    if (!id) return undefined
    return this.list<T>(c).find((e) => e.id === id)
  }

  upsert<T extends Entity>(c: CollectionName, entity: T): T {
    const arr = this.get()[c] as unknown as T[]
    const next = { ...entity, updatedAt: Date.now() }
    const i = arr.findIndex((e) => e.id === entity.id)
    if (i >= 0) arr[i] = next
    else arr.push(next)
    this.changed()
    return next
  }

  remove(c: CollectionName, id: string): void {
    const arr = this.get()[c] as Entity[]
    const i = arr.findIndex((e) => e.id === id)
    if (i >= 0) {
      // Tombstone without payload so the deletion syncs but secrets do not linger.
      arr[i] = { id, updatedAt: Date.now(), deleted: true, teamId: arr[i].teamId }
      this.changed()
    }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const d = this.get()
    d.settings = { ...d.settings, ...patch }
    this.changed()
    return d.settings
  }

  replace(data: VaultData): void {
    this.data = this.normalize(data)
    this.changed()
  }

  /** Encrypt arbitrary payloads with the vault key (used by sync). */
  sealWithVaultKey(text: string): SealedBox & { kdf: KdfParams } {
    if (!this.key || !this.kdf) throw new Error('Vault terkunci')
    return { ...seal(this.key, text), kdf: this.kdf }
  }

  openWithVaultKey(box: SealedBox): string {
    if (!this.key) throw new Error('Vault terkunci')
    return open(this.key, box)
  }

  changed(): void {
    this.emit('changed')
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.key || !this.kdf || !this.data) return
    const file: VaultFile = {
      format: 'termos-vault',
      v: 1,
      kdf: this.kdf,
      ...seal(this.key, JSON.stringify(this.data))
    }
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  private normalize(d: Partial<VaultData>): VaultData {
    const base = emptyVault()
    const out = { ...base, ...d } as VaultData
    out.settings = {
      ...DEFAULT_SETTINGS,
      ...(d.settings ?? {}),
      sync: { ...DEFAULT_SETTINGS.sync, ...(d.settings?.sync ?? {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(d.settings?.ai ?? {}) }
    }
    for (const c of COLLECTIONS) if (!Array.isArray(out[c])) (out[c] as Entity[]) = []
    if (!Array.isArray(out.teams)) out.teams = []
    return out
  }
}

export const vault = new Vault()
