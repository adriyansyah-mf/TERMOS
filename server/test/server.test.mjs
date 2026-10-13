// Integration tests: start the built server on a random port and drive it over HTTP/WebSocket.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import WebSocket from 'ws'

const PORT = 20000 + Math.floor(Math.random() * 20000)
const BASE = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'termos-srv-'))
let proc

const b64 = (s) => Buffer.from(s).toString('base64')
const account = (name) => ({
  username: name,
  authKey: b64(`auth-key-of-${name}-32-bytes-long!!`),
  kdf: { alg: 'argon2id', salt: b64('salt-' + name), m: 65536, t: 3, p: 1 },
  wrappedKey: { nonce: 'n', ct: 'wrapped-' + name },
  publicKey: b64(`public-key-${name}`),
  wrappedPrivateKey: { nonce: 'n', ct: 'priv-' + name },
  deviceName: 'test'
})

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, body: await res.json() }
}

before(async () => {
  proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, TERMOS_PORT: String(PORT), TERMOS_HOST: '127.0.0.1', TERMOS_DB: join(dir, 'db.sqlite') },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve) => proc.stdout.once('data', resolve))
})

after(() => {
  proc.kill()
  rmSync(dir, { recursive: true, force: true })
})

const state = {}

test('first account registers and becomes admin; signup then closes', async () => {
  const r = await call('POST', '/api/register', account('alice'))
  assert.equal(r.status, 200)
  assert.equal(r.body.isAdmin, true)
  state.alice = r.body
  const second = await call('POST', '/api/register', account('bob'))
  assert.equal(second.status, 403)
  assert.equal((await call('GET', '/api/status')).body.signup, 'closed')
})

test('login checks the auth key and returns the wrapped key material', async () => {
  const bad = await call('POST', '/api/login', { username: 'alice', authKey: b64('wrong') })
  assert.equal(bad.status, 401)
  const ok = await call('POST', '/api/login', { username: 'alice', authKey: account('alice').authKey, deviceName: 'laptop 2' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.wrappedKey.ct, 'wrapped-alice')
  state.alice2 = ok.body
  const devices = await call('GET', '/api/devices', null, ok.body.token)
  assert.equal(devices.body.length, 2)
})

test('prelogin answers the same shape for unknown users', async () => {
  const known = await call('POST', '/api/prelogin', { username: 'alice' })
  const unknown = await call('POST', '/api/prelogin', { username: 'ghost' })
  assert.deepEqual(Object.keys(known.body.kdf).sort(), Object.keys(unknown.body.kdf).sort())
})

test('login is rate limited after repeated failures', async () => {
  let last
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', { username: 'ratelimit', authKey: b64('x') })
  assert.equal(last.status, 429)
})

test('sync: push, pull, last-writer-wins, and scope isolation', async () => {
  const t = state.alice.token
  const scope = `u:${state.alice.userId}`
  const push = await call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 100, blob: 'cipher-1' }] }, t)
  assert.equal(push.body.accepted, 1)
  const older = await call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 50, blob: 'old' }] }, t)
  assert.deepEqual(older.body.stale, ['h1'])
  const newer = await call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 200, blob: 'cipher-2', deleted: true }] }, t)
  assert.equal(newer.body.accepted, 1)

  const pull = await call('GET', '/api/sync?since=0', null, state.alice2.token)
  assert.equal(pull.body.records.length, 1)
  assert.equal(pull.body.records[0].blob, 'cipher-2')
  assert.equal(pull.body.records[0].deleted, true)
  const again = await call('GET', `/api/sync?since=${pull.body.cursor}`, null, t)
  assert.equal(again.body.records.length, 0)

  const foreign = await call('POST', '/api/sync', { records: [{ scope: 'u:someone-else', id: 'x', updatedAt: 1, blob: 'b' }] }, t)
  assert.equal(foreign.status, 403)
})

test('teams: owner creates a team and syncs team-scoped records across devices', async () => {
  const t = state.alice.token
  const team = await call('POST', '/api/teams', { name: 'Ops', wrappedTeamKey: { epk: 'e', nonce: 'n', ct: 'k' } }, t)
  assert.equal(team.status, 200)
  const scope = `t:${team.body.id}`
  const push = await call('POST', '/api/sync', { records: [{ scope, id: 'th1', updatedAt: 10, blob: 'team-cipher' }] }, t)
  assert.equal(push.body.accepted, 1)
  const only = await call('GET', `/api/sync?since=0&scope=${encodeURIComponent(scope)}`, null, state.alice2.token)
  assert.deepEqual(only.body.records.map((r) => r.id), ['th1'])
  const teams = await call('GET', '/api/me', null, t)
  assert.equal(teams.body.teams[0].name, 'Ops')
  assert.equal(teams.body.teams[0].role, 'owner')
  const missingUser = await call('GET', '/api/users/nobody/key', null, t)
  assert.equal(missingUser.status, 404)
  const bad = await call('GET', '/api/sync?since=0&scope=t:not-mine', null, t)
  assert.equal(bad.status, 403)
  state.teamId = team.body.id
})

test('revoked device token stops working', async () => {
  const devs = await call('GET', '/api/devices', null, state.alice.token)
  const other = devs.body.find((d) => !d.current)
  await call('DELETE', `/api/devices/${other.id}`, null, state.alice.token)
  const me = await call('GET', '/api/me', null, state.alice2.token)
  assert.equal(me.status, 401)
})

test('share relay forwards host output to viewers and viewer input to the host', async () => {
  const headers = { Authorization: `Bearer ${state.alice.token}` }
  const host = new WebSocket(`ws://127.0.0.1:${PORT}/api/share/host`, { headers })
  const hostMsgs = []
  host.on('message', (m) => hostMsgs.push(JSON.parse(m.toString())))
  await new Promise((r) => host.once('open', r))
  await waitFor(() => hostMsgs.some((m) => m.t === 'ready'))
  const shareId = hostMsgs.find((m) => m.t === 'ready').shareId

  const viewer = new WebSocket(`ws://127.0.0.1:${PORT}/api/share/join/${shareId}`, { headers })
  const viewerMsgs = []
  viewer.on('message', (m) => viewerMsgs.push(JSON.parse(m.toString())))
  await new Promise((r) => viewer.once('open', r))
  await waitFor(() => hostMsgs.some((m) => m.t === 'joined'))

  host.send(JSON.stringify({ t: 'out', data: 'encrypted-output' }))
  await waitFor(() => viewerMsgs.some((m) => m.data === 'encrypted-output'))
  viewer.send(JSON.stringify({ t: 'in', data: 'encrypted-input' }))
  await waitFor(() => hostMsgs.some((m) => m.t === 'from' && m.data === 'encrypted-input'))

  host.close()
  await waitFor(() => viewerMsgs.some((m) => m.t === 'ended'))
  viewer.close()

  const anon = new WebSocket(`ws://127.0.0.1:${PORT}/api/share/host`)
  const code = await new Promise((r) => anon.once('unexpected-response', (_req, res) => r(res.statusCode)))
  assert.equal(code, 401)
})

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timeout')
}
