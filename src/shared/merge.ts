import {
  COLLECTIONS,
  type ConnConfig,
  type Entity,
  type Group,
  type Host,
  type VaultData
} from './types'

/** Last-writer-wins merge per entity id; tombstones (deleted) win when newer. */
export function mergeCollection<T extends Entity>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>()
  for (const e of local) byId.set(e.id, e)
  for (const e of remote) {
    const mine = byId.get(e.id)
    if (!mine || e.updatedAt > mine.updatedAt) byId.set(e.id, e)
  }
  return [...byId.values()]
}

/** Merge the synced collections of `remote` into `local` (settings stay local). */
export function mergeVaults(local: VaultData, remote: Partial<VaultData>): VaultData {
  const out = { ...local }
  for (const name of COLLECTIONS) {
    const r = remote[name] as Entity[] | undefined
    if (r) (out[name] as Entity[]) = mergeCollection(local[name] as Entity[], r)
  }
  return out
}

export interface ResolvedValue<T> {
  value: T | undefined
  /** 'host', a group id, or undefined when nothing set it. */
  source?: string
}

/** Walk host → group → parent groups and return the first defined value. */
export function resolveConfigValue<K extends keyof ConnConfig>(
  host: Pick<Host, 'config' | 'groupId'>,
  groups: Group[],
  key: K
): ResolvedValue<ConnConfig[K]> {
  if (host.config[key] !== undefined && host.config[key] !== '') {
    return { value: host.config[key], source: 'host' }
  }
  const seen = new Set<string>()
  let gid = host.groupId
  while (gid && !seen.has(gid)) {
    seen.add(gid)
    const g = groups.find((x) => x.id === gid && !x.deleted)
    if (!g) break
    if (g.config[key] !== undefined && g.config[key] !== '')
      return { value: g.config[key], source: g.id }
    gid = g.parentId
  }
  return { value: undefined }
}

export function resolveConfig(host: Pick<Host, 'config' | 'groupId'>, groups: Group[]): ConnConfig {
  const out: ConnConfig = {}
  const keys = new Set<keyof ConnConfig>()
  for (const k of Object.keys(host.config) as (keyof ConnConfig)[]) keys.add(k)
  for (const g of groups) for (const k of Object.keys(g.config) as (keyof ConnConfig)[]) keys.add(k)
  for (const k of keys) {
    const v = resolveConfigValue(host, groups, k).value
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export function newId(): string {
  return globalThis.crypto.randomUUID()
}
