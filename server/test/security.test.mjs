// Hardening checks: input validation, origin checks, token expiry, quotas, brute force limits.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import WebSocket from 'ws'
import { account, b64, startServer } from './helpers.mjs'

let srv
before(async () => {
  srv = await startServer({
    TERMOS_SIGNUP: 'open',
    TERMOS_MAX_RECORDS: '3',
    TERMOS_SIGNUP_PER_HOUR: '30',
    // ~3.5 seconds of inactivity
    TERMOS_TOKEN_IDLE_DAYS: String(3.5 / 86400)
  })
})
after(() => srv.stop())

test('weak or malformed key material is rejected at registration', async () => {
  const weak = account('weak', { kdf: { alg: 'argon2id', salt: b64(Buffer.alloc(16)), m: 1024, t: 1, p: 1 } })
  assert.equal((await srv.call('POST', '/api/register', weak)).status, 400)
  const wrongAlg = account('wrongalg', { kdf: { alg: 'pbkdf2', salt: b64(Buffer.alloc(16)), m: 65536, t: 3, p: 1 } })
  assert.equal((await srv.call('POST', '/api/register', wrongAlg)).status, 400)
  const shortKey = account('short', { authKey: b64(Buffer.alloc(8)) })
  assert.equal((await srv.call('POST', '/api/register', shortKey)).status, 400)
  const badPub = account('badpub', { publicKey: 'not base64!' })
  assert.equal((await srv.call('POST', '/api/register', badPub)).status, 400)
  const badName = account('../etc/passwd')
  assert.equal((await srv.call('POST', '/api/register', badName)).status, 400)
  const extra = account('extra', { wrappedKey: { nonce: 'n' } })
  assert.equal((await srv.call('POST', '/api/register', extra)).status, 400)
})

test('usernames are unique case-insensitively', async () => {
  assert.equal((await srv.call('POST', '/api/register', account('Erin'))).status, 200)
  assert.equal((await srv.call('POST', '/api/register', account('erin'))).status, 409)
})

test('non-JSON bodies are refused', async () => {
  const res = await srv.call('POST', '/api/login', 'username=a', undefined, { 'Content-Type': 'application/x-www-form-urlencoded' })
  assert.equal(res.status, 415)
  assert.equal((await srv.call('POST', '/api/login', '[1,2]')).status, 400)
})

test('responses carry defensive headers and unknown routes are 404', async () => {
  const res = await fetch(srv.base + '/api/status')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/)
  assert.equal((await srv.call('GET', '/api/../etc/passwd')).status, 404)
  assert.equal((await srv.call('PUT', '/api/status')).status, 405)
})

test('malformed bearer tokens and ids are rejected', async () => {
  assert.equal((await srv.call('GET', '/api/me', undefined, "x' OR 1=1 --")).status, 401)
  const u = (await srv.call('POST', '/api/register', account('frank'))).body
  assert.equal((await srv.call('DELETE', "/api/devices/1;DROP TABLE users", undefined, u.token)).status, 404)
  assert.equal((await srv.call('DELETE', '/api/devices/not-a-uuid', undefined, u.token)).status, 400)
  assert.equal((await srv.call('GET', '/api/me', undefined, u.token)).status, 200)
})

test('browser-originated WebSocket upgrades are refused', async () => {
  const u = (await srv.call('POST', '/api/register', account('gina'))).body
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/share/host`, {
    headers: { Authorization: `Bearer ${u.token}`, Origin: 'https://evil.example' }
  })
  assert.equal(await new Promise((r) => ws.once('unexpected-response', (_q, res) => r(res.statusCode))), 403)
})

test('storage quota per vault is enforced atomically', async () => {
  const u = (await srv.call('POST', '/api/register', account('henry'))).body
  const scope = `u:${u.userId}`
  const rec = (id) => ({ scope, id, updatedAt: 1, blob: 'x' })
  assert.equal((await srv.call('POST', '/api/sync', { records: [rec('a'), rec('b'), rec('c')] }, u.token)).status, 200)
  const over = await srv.call('POST', '/api/sync', { records: [{ ...rec('b'), updatedAt: 2 }, rec('d')] }, u.token)
  assert.equal(over.status, 507)
  // The rejected batch rolled back: 'b' kept its old version.
  const pull = (await srv.call('GET', '/api/sync?since=0', undefined, u.token)).body.records
  assert.equal(pull.find((r) => r.id === 'b').updatedAt, 1)
  assert.equal(pull.length, 3)
})

test('per-IP login limit stops spraying across many usernames', async () => {
  let last
  for (let i = 0; i < 51; i++)
    last = await srv.call('POST', '/api/login', { username: `spray${i}`, authKey: b64(Buffer.alloc(32)) })
  assert.equal(last.status, 429)
})

test('device tokens expire after the idle window', async () => {
  const res = await srv.call('POST', '/api/register', account('ivy'))
  assert.equal(res.status, 200)
  const token = res.body.token
  assert.equal((await srv.call('GET', '/api/me', undefined, token)).status, 200)
  await new Promise((r) => setTimeout(r, 4000))
  assert.equal((await srv.call('GET', '/api/me', undefined, token)).status, 401)
  // The expired device row is gone, not just refused.
  assert.equal((await srv.call('GET', '/api/me', undefined, token)).status, 401)
})

test('registration is rate limited per IP', async () => {
  let last
  for (let i = 0; i < 31; i++) last = await srv.call('POST', '/api/register', account(`bulk${i}`))
  assert.equal(last.status, 429)
})
