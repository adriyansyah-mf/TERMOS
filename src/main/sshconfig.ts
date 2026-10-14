import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import SSHConfig from 'ssh-config'
import { newId } from '../shared/merge'
import type { Group, Host, SshKey } from '../shared/types'
import { fmt, tr } from './i18n'
import { expandHome, importKeyFile } from './keys'
import { vault } from './vault'

export interface ImportResult {
  added: number
  updated: number
  keys: number
  skipped: string[]
}

const S = {
  id: {
    notFound: 'File %s tidak ditemukan',
    groupLabel: 'SSH config',
    skippedJump: '%s: ProxyJump %s tidak dikenal'
  },
  en: {
    notFound: 'File %s not found',
    groupLabel: 'SSH config',
    skippedJump: '%s: unknown ProxyJump %s'
  }
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

/** Import concrete Host entries (no wildcards) from an OpenSSH config file. */
export function importSshConfig(path = join(homedir(), '.ssh', 'config')): ImportResult {
  if (!existsSync(path)) throw new Error(fmt(tr(S).notFound, path))
  const config = SSHConfig.parse(readFileSync(path, 'utf8'))
  const result: ImportResult = { added: 0, updated: 0, keys: 0, skipped: [] }

  let group = vault.list<Group>('groups').find((g) => g.label === tr(S).groupLabel)
  if (!group) {
    group = vault.upsert<Group>('groups', {
      id: newId(),
      updatedAt: Date.now(),
      label: tr(S).groupLabel,
      config: {}
    })
  }

  const aliases: string[] = []
  for (const line of config) {
    if ('param' in line && line.param.toLowerCase() === 'host') {
      const values = Array.isArray(line.value)
        ? line.value.map((v) => (typeof v === 'string' ? v : v.val))
        : String(line.value).split(/\s+/)
      for (const a of values) if (a && !/[*?!]/.test(a)) aliases.push(a)
    }
  }

  const keyByPath = new Map<string, SshKey>()
  const ensureKey = (file: string): SshKey | undefined => {
    const full = expandHome(file)
    if (keyByPath.has(full)) return keyByPath.get(full)
    const existing = vault.list<SshKey>('keys').find((k) => k.label === full)
    if (existing) {
      keyByPath.set(full, existing)
      return existing
    }
    if (!existsSync(full)) return undefined
    try {
      const key = { ...importKeyFile(full), label: full }
      vault.upsert('keys', key)
      keyByPath.set(full, key)
      result.keys++
      return key
    } catch {
      // Encrypted keys need a passphrase; leave them for the user to import by hand.
      return undefined
    }
  }

  const hostIdByAlias = new Map<string, string>()
  const existingHosts = vault.list<Host>('hosts')
  for (const alias of aliases) {
    const c = config.compute(alias)
    const address = first(c.HostName) ?? alias
    const port = Number(first(c.Port)) || undefined
    const identity = first(c.IdentityFile)
    const key = identity ? ensureKey(identity) : undefined
    const prev = existingHosts.find((h) => h.source?.kind === 'sshconfig' && h.source.ref === alias)
    const host: Host = {
      id: prev?.id ?? newId(),
      updatedAt: Date.now(),
      label: alias,
      address,
      protocol: 'ssh',
      groupId: prev?.groupId ?? group.id,
      tags: prev?.tags ?? [],
      source: { kind: 'sshconfig', ref: alias },
      config: {
        ...(prev?.config ?? {}),
        port,
        username: first(c.User),
        keyId: key?.id ?? prev?.config.keyId,
        agentForwarding: /^yes$/i.test(first(c.ForwardAgent) ?? '') || undefined
      }
    }
    vault.upsert('hosts', host)
    hostIdByAlias.set(alias, host.id)
    if (prev) result.updated++
    else result.added++
  }

  // Second pass: ProxyJump chains can reference any imported alias.
  for (const alias of aliases) {
    const jump = first(config.compute(alias).ProxyJump)
    if (!jump || jump === 'none') continue
    const chain: string[] = []
    for (const hop of jump.split(',')) {
      const name = hop.replace(/^.*@/, '').replace(/:\d+$/, '')
      const id = hostIdByAlias.get(name)
      if (id) chain.push(id)
      else result.skipped.push(fmt(tr(S).skippedJump, alias, hop))
    }
    const host = vault.find<Host>('hosts', hostIdByAlias.get(alias))
    if (host && chain.length)
      vault.upsert('hosts', { ...host, config: { ...host.config, hostChain: chain } })
  }
  return result
}
