// Security properties of the client crypto: tamper resistance, binding, replay and reflection protection.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { open, randomKey, seal } from '../src/main/crypto'
import { FrameCodec, HOST } from '../src/main/shareCodec'
import {
  deriveAccountKeys,
  keyFingerprint,
  newKeyPair,
  openSealed,
  sealTo,
  unwrap,
  wrap
} from '../src/main/syncCrypto'

const aad = (scope: string, id: string, t: number, del: boolean): string =>
  `termos-record-v1|${scope}|${id}|${t}|${del ? 1 : 0}`

test('records only open with the exact scope, id, timestamp and deleted flag they were sealed with', () => {
  const key = randomKey()
  const box = seal(key, '{"c":"hosts","e":{"label":"db"}}', aad('u:1', 'h1', 100, false))
  assert.equal(open(key, box, aad('u:1', 'h1', 100, false)), '{"c":"hosts","e":{"label":"db"}}')
  assert.throws(() => open(key, box, aad('u:1', 'h2', 100, false)), 'moved to another id')
  assert.throws(() => open(key, box, aad('t:9', 'h1', 100, false)), 'moved to another scope')
  assert.throws(() => open(key, box, aad('u:1', 'h1', 999, false)), 'timestamp bumped')
  assert.throws(() => open(key, box, aad('u:1', 'h1', 100, true)), 'deleted flag flipped')
  assert.throws(() => open(key, box), 'AAD stripped')
})

test('tampered ciphertext or nonce is rejected', () => {
  const key = randomKey()
  const box = seal(key, 'secret', 'ctx')
  const ct = Buffer.from(box.ct, 'base64')
  ct[0] ^= 1
  assert.throws(() => open(key, { ...box, ct: ct.toString('base64') }, 'ctx'))
  assert.throws(() => open(key, { ...box, nonce: Buffer.alloc(24).toString('base64') }, 'ctx'))
  assert.throws(() => open(key, { ...box, nonce: Buffer.alloc(12).toString('base64') }, 'ctx'))
  assert.throws(() => open(randomKey(), box, 'ctx'), 'wrong key')
})

test('nonces are never reused', () => {
  const key = randomKey()
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) seen.add(seal(key, 'x').nonce)
  assert.equal(seen.size, 2000)
})

test('wrapped account keys cannot be swapped by the server', () => {
  const enc = randomKey()
  const syncKey = randomKey()
  const priv = randomKey()
  const wSync = wrap(enc, syncKey, 'syncKey')
  const wPriv = wrap(enc, priv, 'privateKey')
  assert.deepEqual(unwrap(enc, wSync, 'syncKey'), syncKey)
  assert.throws(() => unwrap(enc, wPriv, 'syncKey'))
  assert.throws(() => unwrap(enc, wSync, 'privateKey'))
  assert.throws(() => unwrap(randomKey(), wSync, 'syncKey'))
})

test('team keys sealed to a public key open only with the matching private key', () => {
  const alice = newKeyPair()
  const mallory = newKeyPair()
  const teamKey = randomKey()
  const box = sealTo(alice.publicKey, teamKey)
  assert.deepEqual(openSealed(alice.privateKey, box), teamKey)
  assert.throws(() => openSealed(mallory.privateKey, box))
  const bad = { ...box, epk: newKeyPair().publicKey }
  assert.throws(() => openSealed(alice.privateKey, bad), 'swapped ephemeral key')
  assert.throws(() => sealTo('AAAA', teamKey), 'short public key')
})

test('weak KDF parameters from a server are refused', async () => {
  const salt = Buffer.alloc(16, 1).toString('base64')
  await assert.rejects(deriveAccountKeys('pw', { alg: 'argon2id', salt, m: 1024, t: 1, p: 1 }))
  await assert.rejects(deriveAccountKeys('pw', { alg: 'argon2id', salt, m: 65536, t: 1, p: 1 }))
  await assert.rejects(deriveAccountKeys('pw', { alg: 'argon2id', salt: 'AAAA', m: 65536, t: 3, p: 1 }))
  await assert.rejects(deriveAccountKeys('pw', { alg: 'pbkdf2' as 'argon2id', salt, m: 65536, t: 3, p: 1 }))
})

test('account key derivation is deterministic and separates auth from encryption', async () => {
  const kdf = { alg: 'argon2id' as const, salt: Buffer.alloc(16, 2).toString('base64'), m: 65536, t: 3, p: 1 }
  const a = await deriveAccountKeys('correct horse', kdf)
  const b = await deriveAccountKeys('correct horse', kdf)
  const c = await deriveAccountKeys('correct horsf', kdf)
  assert.equal(a.authKey, b.authKey)
  assert.notEqual(a.authKey, c.authKey)
  assert.notEqual(a.authKey, Buffer.from(a.encKey).toString('base64'), 'server never learns encKey')
})

test('key fingerprints are stable and distinguish keys', () => {
  const k = newKeyPair().publicKey
  assert.equal(keyFingerprint(k), keyFingerprint(k))
  assert.match(keyFingerprint(k), /^(\d{5} ){7}\d{5}$/)
  assert.notEqual(keyFingerprint(k), keyFingerprint(newKeyPair().publicKey))
})

test('share frames: relay cannot reflect, replay, forge or redirect', () => {
  const key = randomKey()
  const host = new FrameCodec(key, 'share-AAAAAAAAAAAAAAAA')
  const viewer = new FrameCodec(key, 'share-AAAAAAAAAAAAAAAA')

  const out = host.encode('h2v', HOST, 'ls -la output')
  assert.equal(viewer.decode('h2v', out), 'ls -la output')
  assert.equal(viewer.decode('h2v', out), null, 'replayed output')
  // The dangerous one: host output bounced back to the host as if a viewer typed it.
  assert.equal(new FrameCodec(key, 'share-AAAAAAAAAAAAAAAA').decode('v2h', out), null, 'reflected')

  const input = viewer.encode('v2h', 'viewer-1', 'whoami\r')
  assert.equal(host.decode('v2h', input), 'whoami\r')
  assert.equal(host.decode('v2h', input), null, 'replayed input')
  const relabeled = JSON.stringify({ ...JSON.parse(input), s: 'viewer-2' })
  assert.equal(host.decode('v2h', relabeled), null, 'input replayed under another viewer id')
  const asHost = JSON.stringify({ ...JSON.parse(input), s: HOST })
  assert.equal(new FrameCodec(key, 'share-AAAAAAAAAAAAAAAA').decode('h2v', asHost), null, 'viewer posing as host')

  const otherShare = new FrameCodec(key, 'share-BBBBBBBBBBBBBBBB')
  assert.equal(otherShare.decode('h2v', host.encode('h2v', HOST, 'x')), null, 'frame from another share')
  assert.equal(new FrameCodec(randomKey(), 'share-AAAAAAAAAAAAAAAA').decode('h2v', host.encode('h2v', HOST, 'y')), null, 'wrong key')
  assert.equal(viewer.decode('h2v', 'not json'), null)
  assert.equal(viewer.decode('h2v', '{"s":"host","n":-1}'), null)
})
