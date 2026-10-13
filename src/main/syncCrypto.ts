import { argon2idAsync } from '@noble/hashes/argon2'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { x25519 } from '@noble/curves/ed25519'
import { randomBytes } from 'node:crypto'
import { b64, openBytes, seal, unb64, type SealedBox } from './crypto'

/**
 * Account crypto for the self-hosted sync server (same idea as Bitwarden):
 *
 *   master  = Argon2id(password, salt)
 *   authKey = HKDF(master, "termos-auth")  -> sent to the server to log in
 *   encKey  = HKDF(master, "termos-enc")   -> never leaves the device
 *
 * encKey wraps a random syncKey (encrypts personal records) and the X25519
 * private key (opens team keys sealed by teammates).
 */

export interface AccountKdf {
  alg: 'argon2id'
  salt: string
  m: number
  t: number
  p: number
}

export interface SealedToKey {
  epk: string
  nonce: string
  ct: string
}

export function newAccountKdf(): AccountKdf {
  // 64 MiB, 3 passes: heavier than the local vault KDF because the server sees authKey.
  return { alg: 'argon2id', salt: b64(randomBytes(16)), m: 65536, t: 3, p: 1 }
}

export async function deriveAccountKeys(
  password: string,
  kdf: AccountKdf
): Promise<{ authKey: string; encKey: Uint8Array }> {
  if (kdf.alg !== 'argon2id' || kdf.m < 8192 || kdf.t < 1)
    throw new Error('Parameter KDF server tidak aman')
  const master = await argon2idAsync(password, unb64(kdf.salt), {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: 32
  })
  return {
    authKey: b64(hkdf(sha256, master, undefined, 'termos-auth', 32)),
    encKey: hkdf(sha256, master, undefined, 'termos-enc', 32)
  }
}

export function newKeyPair(): { publicKey: string; privateKey: Uint8Array } {
  const privateKey = x25519.utils.randomPrivateKey()
  return { publicKey: b64(x25519.getPublicKey(privateKey)), privateKey }
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32))
}

export function wrap(key: Uint8Array, secret: Uint8Array): SealedBox {
  return seal(key, secret)
}

export function unwrap(key: Uint8Array, box: SealedBox): Uint8Array {
  try {
    return openBytes(key, box)
  } catch {
    throw new Error('Password akun salah atau data akun rusak')
  }
}

function sealKey(shared: Uint8Array, epk: Uint8Array, recipient: Uint8Array): Uint8Array {
  const salt = new Uint8Array([...epk, ...recipient])
  return hkdf(sha256, shared, salt, 'termos-seal', 32)
}

/** Anonymous sealed box: anyone with the recipient's public key can seal, only they can open. */
export function sealTo(recipientPublicKey: string, data: Uint8Array): SealedToKey {
  const recipient = unb64(recipientPublicKey)
  const eph = x25519.utils.randomPrivateKey()
  const epk = x25519.getPublicKey(eph)
  const key = sealKey(x25519.getSharedSecret(eph, recipient), epk, recipient)
  return { epk: b64(epk), ...seal(key, data) }
}

export function openSealed(privateKey: Uint8Array, box: SealedToKey): Uint8Array {
  const epk = unb64(box.epk)
  const self = x25519.getPublicKey(privateKey)
  const key = sealKey(x25519.getSharedSecret(privateKey, epk), epk, self)
  return openBytes(key, box)
}
