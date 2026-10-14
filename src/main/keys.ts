import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { utils } from 'ssh2'
import { newId } from '../shared/merge'
import type { SshKey } from '../shared/types'
import { fmt, tr } from './i18n'
import { fingerprint } from './ssh/connect'

const S = {
  id: {
    encrypted: 'Key ini terenkripsi; isi passphrase-nya',
    invalid: 'Key tidak valid: %s'
  },
  en: {
    encrypted: 'This key is encrypted; enter its passphrase',
    invalid: 'Invalid key: %s'
  }
}

export type KeyKind = 'ed25519' | 'rsa' | 'ecdsa'

export function generateKey(label: string, kind: KeyKind, passphrase?: string): SshKey {
  const opts: Record<string, unknown> = { comment: label }
  if (kind === 'rsa') opts.bits = 4096
  if (kind === 'ecdsa') opts.bits = 256
  if (passphrase) {
    opts.passphrase = passphrase
    opts.cipher = 'aes256-ctr'
  }
  const pair = utils.generateKeyPairSync(kind, opts as never)
  return {
    id: newId(),
    updatedAt: Date.now(),
    label,
    keyType: kind,
    privateKey: pair.private,
    publicKey: pair.public,
    passphrase: passphrase || undefined
  }
}

/** Parse a private key (optionally encrypted) and derive its public half. */
export function keyFromPrivate(
  label: string,
  privateKey: string,
  passphrase?: string,
  certificate?: string
): SshKey {
  const parsed = utils.parseKey(privateKey, passphrase || undefined)
  if (parsed instanceof Error) {
    if (/encrypted|passphrase/i.test(parsed.message) && !passphrase)
      throw new Error(tr(S).encrypted)
    throw new Error(fmt(tr(S).invalid, parsed.message))
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  const pub = `${key.type} ${key.getPublicSSH().toString('base64')} ${label}`
  return {
    id: newId(),
    updatedAt: Date.now(),
    label,
    keyType: key.type,
    privateKey,
    publicKey: pub,
    passphrase: passphrase || undefined,
    certificate: certificate || undefined
  }
}

export function importKeyFile(path: string, passphrase?: string): SshKey {
  const priv = readFileSync(path, 'utf8')
  const certPath = path + '-cert.pub'
  const cert = existsSync(certPath) ? readFileSync(certPath, 'utf8') : undefined
  return keyFromPrivate(basename(path), priv, passphrase, cert)
}

export function keyFingerprint(k: SshKey): string {
  const b64 = k.publicKey.trim().split(/\s+/)[1]
  return b64 ? fingerprint(Buffer.from(b64, 'base64')) : ''
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p
}
