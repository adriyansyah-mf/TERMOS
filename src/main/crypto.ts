import { argon2idAsync } from '@noble/hashes/argon2'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes } from 'node:crypto'
import { tr } from './i18n'

const S = {
  id: { corruptData: 'Data terenkripsi rusak' },
  en: { corruptData: 'Encrypted data is corrupt' }
}

export interface KdfParams {
  alg: 'argon2id'
  salt: string
  m: number
  t: number
  p: number
}

export interface SealedBox {
  nonce: string
  ct: string
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64')
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'))

export function newKdfParams(): KdfParams {
  // Above the OWASP Argon2id baseline (19 MiB, t=2): 64 MiB, 3 passes. Unlock takes ~1 s.
  return { alg: 'argon2id', salt: b64(randomBytes(16)), m: 65536, t: 3, p: 1 }
}

export async function deriveKey(password: string, kdf: KdfParams): Promise<Uint8Array> {
  return argon2idAsync(password, unb64(kdf.salt), { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32 })
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32))
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/**
 * XChaCha20-Poly1305 with a random 192-bit nonce. `aad` is authenticated but not
 * encrypted: it binds the ciphertext to its context (record id, direction, ...),
 * so a box cannot be moved to another place without failing to open.
 */
export function seal(key: Uint8Array, plaintext: string | Uint8Array, aad?: string): SealedBox {
  const nonce = new Uint8Array(randomBytes(24))
  const data = typeof plaintext === 'string' ? enc(plaintext) : plaintext
  const ct = xchacha20poly1305(key, nonce, aad === undefined ? undefined : enc(aad)).encrypt(data)
  return { nonce: b64(nonce), ct: b64(ct) }
}

export function openBytes(key: Uint8Array, box: SealedBox, aad?: string): Uint8Array {
  if (typeof box?.nonce !== 'string' || typeof box?.ct !== 'string')
    throw new Error(tr(S).corruptData)
  const nonce = unb64(box.nonce)
  if (nonce.length !== 24) throw new Error(tr(S).corruptData)
  return xchacha20poly1305(key, nonce, aad === undefined ? undefined : enc(aad)).decrypt(
    unb64(box.ct)
  )
}

export function open(key: Uint8Array, box: SealedBox, aad?: string): string {
  return new TextDecoder().decode(openBytes(key, box, aad))
}

export { b64, unb64 }
