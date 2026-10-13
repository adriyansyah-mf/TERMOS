// Shared data model between main and renderer.

export type Protocol = 'ssh' | 'mosh' | 'telnet' | 'serial' | 'local'

export interface Entity {
  id: string
  updatedAt: number
  deleted?: boolean
  /** When set, the entity lives in a team vault and syncs there. */
  teamId?: string
}

export interface EnvVar {
  key: string
  value: string
}

export interface KnockStep {
  port: number
  protocol: 'tcp' | 'udp'
}

/** Connection settings. Every field is optional so hosts can inherit from groups. */
export interface ConnConfig {
  port?: number
  username?: string
  password?: string
  identityId?: string
  keyId?: string
  useAgent?: boolean
  agentForwarding?: boolean
  timeout?: number
  keepAliveInterval?: number
  strictHostKey?: boolean
  env?: EnvVar[]
  startupSnippetId?: string
  proxyId?: string
  hostChain?: string[]
  portKnocking?: KnockStep[]
  charset?: string
  theme?: string
  fontSize?: number
  moshCommand?: string
  logSession?: boolean
  forwardRuleIds?: string[]
  /** 'openssh' runs the system ssh binary (needed for certificates and FIDO2 sk-keys). */
  engine?: 'builtin' | 'openssh'
}

export const CONFIG_KEYS: (keyof ConnConfig)[] = [
  'port',
  'username',
  'password',
  'identityId',
  'keyId',
  'useAgent',
  'agentForwarding',
  'timeout',
  'keepAliveInterval',
  'strictHostKey',
  'env',
  'startupSnippetId',
  'proxyId',
  'hostChain',
  'portKnocking',
  'charset',
  'theme',
  'fontSize',
  'moshCommand',
  'logSession',
  'forwardRuleIds',
  'engine'
]

export interface Group extends Entity {
  label: string
  parentId?: string
  config: ConnConfig
}

export interface Host extends Entity {
  label: string
  address: string
  protocol: Protocol
  groupId?: string
  tags: string[]
  config: ConnConfig
  serial?: { path: string; baudRate: number }
  source?: { kind: 'aws' | 'azure' | 'digitalocean' | 'proxmox' | 'sshconfig'; ref: string }
  lastConnectedAt?: number
}

export interface Identity extends Entity {
  label: string
  username: string
  password?: string
  keyId?: string
}

export interface SshKey extends Entity {
  label: string
  keyType: string
  privateKey: string
  publicKey: string
  passphrase?: string
  certificate?: string
}

export interface KnownHost extends Entity {
  host: string
  port: number
  keyType: string
  fingerprint: string
  key: string
}

export interface ProxyDef extends Entity {
  label: string
  type: 'socks5' | 'socks4' | 'http' | 'command'
  host: string
  port: number
  username?: string
  password?: string
  command?: string
}

export interface ForwardRule extends Entity {
  label: string
  type: 'local' | 'remote' | 'dynamic'
  hostId: string
  bindAddress: string
  bindPort: number
  destHost?: string
  destPort?: number
  autoStart?: boolean
}

export interface Snippet extends Entity {
  label: string
  script: string
  packageId?: string
}

export interface SnippetPackage extends Entity {
  label: string
}

export interface WorkspacePane {
  hostId: string
}

export interface Workspace extends Entity {
  label: string
  tabs: { panes: WorkspacePane[] }[]
}

export interface ProxmoxServer extends Entity {
  label: string
  url: string
  authType: 'token' | 'password'
  tokenId?: string
  tokenSecret?: string
  username?: string
  password?: string
  realm?: string
  /** SHA-256 fingerprint pinned on first connect (TOFU) for self-signed certs. */
  fingerprint?: string
  /** Saved host used when opening an SSH session to a node. */
  sshHostId?: string
}

export interface HistoryEntry extends Entity {
  hostId: string
  command: string
  at: number
}

export interface TeamVault {
  id: string
  label: string
  /** base64 32-byte symmetric key; the server only ever sees it sealed to members' public keys. */
  key: string
  role?: 'owner' | 'member'
}

/** Account on a self-hosted termos-server. Keys stay inside the local encrypted vault. */
export interface SyncSettings {
  enabled: boolean
  serverUrl: string
  token: string
  lastSyncAt?: number
  username?: string
  userId?: string
  isAdmin?: boolean
  /** Highest server change number already applied locally. */
  cursor?: number
  /** base64 key that encrypts personal records. */
  syncKey?: string
  publicKey?: string
  /** base64 X25519 private key used to open team keys. */
  privateKey?: string
  lastError?: string
}

export interface Settings {
  theme: string
  fontFamily: string
  fontSize: number
  cursorBlink: boolean
  scrollback: number
  autocomplete: boolean
  recordHistory: boolean
  /** Lock the vault after this many idle minutes; 0 disables. */
  autoLockMinutes: number
  /** Lock when the computer sleeps or the screen is locked. */
  lockOnSleep: boolean
  sync: SyncSettings
  ai: { enabled: boolean; apiKey: string; model: string }
}

/** Per-entity record of what the server last confirmed: updatedAt and scope. */
export type SyncState = Record<string, { t: number; s: string }>

export interface VaultData {
  version: 1
  hosts: Host[]
  groups: Group[]
  identities: Identity[]
  keys: SshKey[]
  knownHosts: KnownHost[]
  proxies: ProxyDef[]
  forwardRules: ForwardRule[]
  snippets: Snippet[]
  snippetPackages: SnippetPackage[]
  workspaces: Workspace[]
  proxmox: ProxmoxServer[]
  history: HistoryEntry[]
  teams: TeamVault[]
  settings: Settings
  syncState: SyncState
}

export type CollectionName = Exclude<
  keyof VaultData,
  'version' | 'settings' | 'teams' | 'syncState'
>

/** Command history stays on the device; everything else syncs. */
export const SYNCED_COLLECTIONS: CollectionName[] = [
  'hosts',
  'groups',
  'identities',
  'keys',
  'knownHosts',
  'proxies',
  'forwardRules',
  'snippets',
  'snippetPackages',
  'workspaces',
  'proxmox'
]

export const COLLECTIONS: CollectionName[] = [
  'hosts',
  'groups',
  'identities',
  'keys',
  'knownHosts',
  'proxies',
  'forwardRules',
  'snippets',
  'snippetPackages',
  'workspaces',
  'proxmox',
  'history'
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'termos-dark',
  fontFamily: "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
  fontSize: 14,
  cursorBlink: true,
  scrollback: 10000,
  autocomplete: true,
  recordHistory: true,
  autoLockMinutes: 15,
  lockOnSleep: true,
  sync: { enabled: false, serverUrl: '', token: '' },
  ai: { enabled: false, apiKey: '', model: 'claude-sonnet-5-5' }
}

export function emptyVault(): VaultData {
  return {
    version: 1,
    hosts: [],
    groups: [],
    identities: [],
    keys: [],
    knownHosts: [],
    proxies: [],
    forwardRules: [],
    snippets: [],
    snippetPackages: [],
    workspaces: [],
    proxmox: [],
    history: [],
    teams: [],
    syncState: {},
    settings: structuredClone(DEFAULT_SETTINGS)
  }
}

/** Events pushed from main to renderer on the 'session:event' channel. */
export type SessionEvent =
  | { type: 'data'; sessionId: string; data: string }
  | {
      type: 'status'
      sessionId: string
      status: 'connecting' | 'connected' | 'closed' | 'error'
      message?: string
    }
  | {
      type: 'hostkey'
      sessionId: string
      requestId: string
      host: string
      port: number
      keyType: string
      fingerprint: string
      changed: boolean
    }
  | {
      type: 'prompt'
      sessionId: string
      requestId: string
      title: string
      prompts: { prompt: string; echo: boolean }[]
    }

export type SessionTarget =
  | { kind: 'host'; hostId: string }
  | { kind: 'adhoc'; host: Partial<Host> }
  | { kind: 'proxmox'; serverId: string; node: string; vmType?: 'qemu' | 'lxc'; vmid?: number }
  | { kind: 'multiplayer'; invite: string }

export interface OpenSessionRequest {
  target: SessionTarget
  cols: number
  rows: number
}

export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mode: number
  mtime: number
}

export interface ForwardStatus {
  ruleId: string
  active: boolean
  error?: string
}

/** Proxmox cluster resource as returned by /cluster/resources (subset). */
export interface PveResource {
  id: string
  type: 'node' | 'qemu' | 'lxc' | 'storage' | string
  node: string
  vmid?: number
  name?: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  template?: number
  tags?: string
}
