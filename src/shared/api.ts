import type {
  CollectionName,
  Entity,
  ForwardStatus,
  OpenSessionRequest,
  ProxmoxServer,
  PveResource,
  SessionEvent,
  Settings,
  SftpEntry,
  SshKey,
  VaultData
} from './types'

export interface SyncStatus {
  connected: boolean
  serverUrl: string
  username?: string
  isAdmin?: boolean
  lastSyncAt?: number
  lastError?: string
  syncing: boolean
  teams: { id: string; label: string; role?: string }[]
}

export interface ShareInfo {
  sessionId: string
  link: string
  allowInput: boolean
  viewers: { id: string; username: string }[]
}

export interface SyncDevice {
  id: string
  name: string
  createdAt: number
  lastSeen: number
  current: boolean
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  quickUnlock: boolean
}

export interface PveSnapshot {
  name: string
  description?: string
  snaptime?: number
}

export interface PveTask {
  upid: string
  type: string
  id?: string
  user: string
  status?: string
  starttime: number
  endtime?: number
}

export type GuestType = 'qemu' | 'lxc'
export type GuestAction = 'start' | 'shutdown' | 'stop' | 'reboot' | 'suspend' | 'resume'

export interface TransferProgress {
  transferId: string
  name: string
  done: number
  total: number
  finished?: boolean
  error?: string
}

export interface ImportResult {
  added: number
  updated: number
  keys: number
  skipped: string[]
}

/** Request/response calls (ipcMain.handle). Every method returns a Promise in the renderer. */
export interface TermosApi {
  vaultStatus(): VaultStatus
  vaultCreate(password: string): void
  vaultUnlock(password: string): void
  vaultQuickUnlock(): void
  vaultLock(): void
  vaultChangePassword(oldPassword: string, newPassword: string): void
  vaultSetQuickUnlock(enabled: boolean): void
  vaultSnapshot(): VaultData
  upsert<T extends Entity>(collection: CollectionName, entity: T): T
  remove(collection: CollectionName, id: string): void
  updateSettings(patch: Partial<Settings>): Settings

  syncStatus(): SyncStatus
  syncServerInfo(serverUrl: string): { signup: string; users: number; version: string }
  syncRegister(serverUrl: string, username: string, password: string, inviteCode?: string): void
  syncLogin(serverUrl: string, username: string, password: string): void
  syncLogout(): void
  syncNow(): void
  syncChangePassword(oldPassword: string, newPassword: string): void
  syncDevices(): SyncDevice[]
  syncRevokeDevice(id: string): void
  teamCreate(name: string): void
  teamMembers(teamId: string): { userId: string; username: string; role: string }[]
  teamAddMember(teamId: string, username: string): void
  teamRemoveMember(teamId: string, userId: string): void
  teamDelete(teamId: string): void

  shareStart(sessionId: string, allowInput: boolean): ShareInfo
  shareStop(sessionId: string): void
  shareSetInput(sessionId: string, allow: boolean): void
  shareKick(sessionId: string, viewer: string): void
  shareList(): ShareInfo[]

  sessionOpen(req: OpenSessionRequest): { sessionId: string; label: string }
  sessionClose(id: string): void
  sessionAnswer(requestId: string, value: unknown): void
  serialPorts(): { path: string; label: string }[]

  keyGenerate(label: string, kind: 'ed25519' | 'rsa' | 'ecdsa', passphrase?: string): SshKey
  keyImportFile(): SshKey | null
  keyImportText(
    label: string,
    privateKey: string,
    passphrase?: string,
    certificate?: string
  ): SshKey
  keyFingerprint(keyId: string): string
  importSshConfig(): ImportResult

  forwardStatus(): ForwardStatus[]
  forwardStart(ruleId: string): void
  forwardStop(ruleId: string): void

  sftpConnect(hostId: string): { sftpId: string; home: string }
  sftpClose(sftpId: string): void
  sftpList(sftpId: string, dir: string): SftpEntry[]
  sftpRealpath(sftpId: string, path: string): string
  sftpMkdir(sftpId: string, path: string): void
  sftpRename(sftpId: string, from: string, to: string): void
  sftpRemove(sftpId: string, path: string, isDir: boolean): void
  sftpChmod(sftpId: string, path: string, mode: number): void
  sftpReadText(sftpId: string, path: string): string
  sftpWriteText(sftpId: string, path: string, text: string): void
  /** Asks for a local folder, then downloads into it. Returns the folder or null. */
  sftpDownload(sftpId: string, remotePaths: { path: string; isDir: boolean }[]): string | null
  /** Asks for local files, then uploads them. Returns how many were chosen. */
  sftpUploadDialog(sftpId: string, remoteDir: string): number
  sftpUploadPaths(sftpId: string, localPaths: string[], remoteDir: string): void

  pveVersion(server: ProxmoxServer): { version: string; release: string }
  pveProbe(url: string): { fingerprint: string; subject: string }
  pveResources(serverId: string): PveResource[]
  pveAction(
    serverId: string,
    node: string,
    type: GuestType,
    vmid: number,
    action: GuestAction
  ): void
  pveSnapshots(serverId: string, node: string, type: GuestType, vmid: number): PveSnapshot[]
  pveSnapshotCreate(
    serverId: string,
    node: string,
    type: GuestType,
    vmid: number,
    name: string
  ): void
  pveSnapshotRollback(
    serverId: string,
    node: string,
    type: GuestType,
    vmid: number,
    name: string
  ): void
  pveSnapshotDelete(
    serverId: string,
    node: string,
    type: GuestType,
    vmid: number,
    name: string
  ): void
  pveTasks(serverId: string, node: string): PveTask[]
  pveGuestAddresses(serverId: string, node: string, type: GuestType, vmid: number): string[]
  pveOpenConsole(
    serverId: string,
    node: string,
    type?: GuestType,
    vmid?: number,
    name?: string
  ): void

  openExternal(url: string): void
  appVersion(): string
}

export type Promisified<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

/** Events pushed from main to renderer. */
export interface TermosEvents {
  'session:event': SessionEvent
  'vault:changed': void
  'vault:locked': void
  'forwards:status': ForwardStatus[]
  'sftp:progress': TransferProgress
  'sync:status': SyncStatus
  'share:status': ShareInfo[]
}

export interface PreloadBridge {
  invoke(method: keyof TermosApi, ...args: unknown[]): Promise<unknown>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  on<K extends keyof TermosEvents>(channel: K, fn: (payload: TermosEvents[K]) => void): () => void
  pathForFile(file: File): string
}
