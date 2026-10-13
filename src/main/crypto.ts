import { argon2idAsync } from '@noble/hashes/argon2'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes } from 'node:crypto'

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
  // OWASP 2023 baseline for Argon2id: 19 MiB, 2 iterations, 1 lane.
  return { alg: 'argon2id', salt: b64(randomBytes(16)), m: 19456, t: 2, p: 1 }
}

export async function deriveKey(password: string, kdf: KdfParams): Promise<Uint8Array> {
  return argon2idAsync(password, unb64(kdf.salt), { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32 })
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32))
}

export function seal(key: Uint8Array, plaintext: string | Uint8Array): SealedBox {
  const nonce = new Uint8Array(randomBytes(24))
  const data = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext
  const ct = xchacha20poly1305(key, nonce).encrypt(data)
  return { nonce: b64(nonce), ct: b64(ct) }
}

export function openBytes(key: Uint8Array, box: SealedBox): Uint8Array {
  return xchacha20poly1305(key, unb64(box.nonce)).decrypt(unb64(box.ct))
}

export function open(key: Uint8Array, box: SealedBox): string {
  return new TextDecoder().decode(openBytes(key, box))
}

export { b64, unb64 }
