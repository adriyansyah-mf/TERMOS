import { argon2idAsync } from '@noble/hashes/argon2'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { x25519 } from '@noble/curves/ed25519'
import { randomBytes } from 'node:crypto'
import { b64, openBytes, seal, unb64, type SealedBox } from './crypto'
import { tr } from './i18n'

const S = {
  id: {
    weakParams: 'Server memberi parameter kunci yang lemah atau tidak valid; login dibatalkan',
    wrongPassword: 'Password akun salah atau data akun rusak',
    invalidRecipient: 'Public key penerima tidak valid',
    teamKeyCorrupt: 'Kunci tim rusak'
  },
  en: {
    weakParams: 'The server offered weak or invalid key parameters; login aborted',
    wrongPassword: 'Wrong account password or corrupt account data',
    invalidRecipient: "Recipient's public key is invalid",
    teamKeyCorrupt: 'Team key is corrupt'
  }
}

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
  // The server hands out these parameters at prelogin. A malicious server could offer
  // weak ones to make the authKey it receives cheap to brute-force, so refuse them.
  if (
    kdf?.alg !== 'argon2id' ||
    !(kdf.m >= 65536 && kdf.m <= 1048576) ||
    !(kdf.t >= 3 && kdf.t <= 20) ||
    !(kdf.p >= 1 && kdf.p <= 8) ||
    unb64(kdf.salt ?? '').length !== 16
  )
    throw new Error(tr(S).weakParams)
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

/** What a wrapped key is; bound into the AEAD so the server cannot swap one wrap for another. */
export type WrapLabel = 'syncKey' | 'privateKey'

export function wrap(key: Uint8Array, secret: Uint8Array, label: WrapLabel): SealedBox {
  return seal(key, secret, `termos-wrap-v1|${label}`)
}

export function unwrap(key: Uint8Array, box: SealedBox, label: WrapLabel): Uint8Array {
  try {
    const out = openBytes(key, box, `termos-wrap-v1|${label}`)
    if (out.length !== 32) throw new Error()
    return out
  } catch {
    throw new Error(tr(S).wrongPassword)
  }
}

function sealKey(shared: Uint8Array, epk: Uint8Array, recipient: Uint8Array): Uint8Array {
  const salt = new Uint8Array([...epk, ...recipient])
  return hkdf(sha256, shared, salt, 'termos-seal', 32)
}

const SEAL_AAD = 'termos-teamkey-v1'

/** Anonymous sealed box: anyone with the recipient's public key can seal, only they can open. */
export function sealTo(recipientPublicKey: string, data: Uint8Array): SealedToKey {
  const recipient = unb64(recipientPublicKey)
  if (recipient.length !== 32) throw new Error(tr(S).invalidRecipient)
  const eph = x25519.utils.randomPrivateKey()
  const epk = x25519.getPublicKey(eph)
  const key = sealKey(x25519.getSharedSecret(eph, recipient), epk, recipient)
  return { epk: b64(epk), ...seal(key, data, SEAL_AAD) }
}

export function openSealed(privateKey: Uint8Array, box: SealedToKey): Uint8Array {
  const epk = unb64(box.epk)
  if (epk.length !== 32) throw new Error(tr(S).teamKeyCorrupt)
  const self = x25519.getPublicKey(privateKey)
  const key = sealKey(x25519.getSharedSecret(privateKey, epk), epk, self)
  const out = openBytes(key, box, SEAL_AAD)
  if (out.length !== 32) throw new Error(tr(S).teamKeyCorrupt)
  return out
}

/**
 * Human-checkable fingerprint of an account public key: 8 groups of 5 digits.
 * Compare it with your teammate over another channel (phone, chat) before sharing
 * a team with them; a mismatch means the server handed out a different key.
 */
export function keyFingerprint(publicKey: string): string {
  const h = sha256(
    new Uint8Array([...new TextEncoder().encode('termos-fp-v1'), ...unb64(publicKey)])
  )
  const groups: string[] = []
  for (let i = 0; i < 8; i++) {
    const n = ((h[i * 3] << 16) | (h[i * 3 + 1] << 8) | h[i * 3 + 2]) % 100000
    groups.push(String(n).padStart(5, '0'))
  }
  return groups.join(' ')
}
