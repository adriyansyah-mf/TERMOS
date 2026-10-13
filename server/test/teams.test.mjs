// Multi-user team access: owner, member and outsider on a server with open signup.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const PORT = 20000 + Math.floor(Math.random() * 20000)
const BASE = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'termos-teams-'))
let proc

const b64 = (s) => Buffer.from(s).toString('base64')
const account = (name) => ({
  username: name,
  authKey: b64(`auth-key-of-${name}-32-bytes-long!!`),
  kdf: { alg: 'argon2id', salt: b64('salt-' + name), m: 65536, t: 3, p: 1 },
  wrappedKey: { nonce: 'n', ct: 'w' },
  publicKey: b64(`public-key-${name}`),
  wrappedPrivateKey: { nonce: 'n', ct: 'p' }
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
    env: {
      ...process.env,
      TERMOS_PORT: String(PORT),
      TERMOS_HOST: '127.0.0.1',
      TERMOS_DB: join(dir, 'db.sqlite'),
      TERMOS_SIGNUP: 'open'
    },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve) => proc.stdout.once('data', resolve))
})

after(() => {
  proc.kill()
  rmSync(dir, { recursive: true, force: true })
})

test('member sees team records after being added; outsider and removed member do not', async () => {
  const alice = (await call('POST', '/api/register', account('alice'))).body
  const bob = (await call('POST', '/api/register', account('bob'))).body
  const carol = (await call('POST', '/api/register', account('carol'))).body
  assert.ok(alice.token && bob.token && carol.token)

  const team = (await call('POST', '/api/teams', { name: 'Ops', wrappedTeamKey: { ct: 'for-alice' } }, alice.token)).body
  const scope = `t:${team.id}`
  await call('POST', '/api/sync', { records: [{ scope, id: 'srv1', updatedAt: 5, blob: 'team-host' }] }, alice.token)

  // Before joining, bob cannot read or write the team scope.
  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, null, bob.token)).status, 403)

  const key = (await call('GET', '/api/users/bob/key', null, alice.token)).body
  assert.equal(key.publicKey, b64('public-key-bob'))
  const add = await call('POST', `/api/teams/${team.id}/members`, { userId: key.userId, wrappedTeamKey: { ct: 'for-bob' } }, alice.token)
  assert.equal(add.status, 200)

  const bobMe = (await call('GET', '/api/me', null, bob.token)).body
  assert.equal(bobMe.teams[0].wrappedTeamKey.ct, 'for-bob')
  assert.equal(bobMe.teams[0].role, 'member')
  const bobPull = (await call('GET', `/api/sync?since=0&scope=${scope}`, null, bob.token)).body
  assert.deepEqual(bobPull.records.map((r) => r.blob), ['team-host'])
  assert.equal((await call('POST', '/api/sync', { records: [{ scope, id: 'srv2', updatedAt: 6, blob: 'by-bob' }] }, bob.token)).body.accepted, 1)

  // A member cannot add people; only the owner can.
  assert.equal((await call('POST', `/api/teams/${team.id}/members`, { userId: carol.userId, wrappedTeamKey: { ct: 'x' } }, bob.token)).status, 403)
  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, null, carol.token)).status, 403)
  assert.equal((await call('GET', `/api/teams/${team.id}/members`, null, carol.token)).status, 404)

  const members = (await call('GET', `/api/teams/${team.id}/members`, null, alice.token)).body
  assert.deepEqual(members.map((m) => m.username).sort(), ['alice', 'bob'])

  await call('DELETE', `/api/teams/${team.id}/members/${bob.userId}`, null, alice.token)
  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, null, bob.token)).status, 403)
  assert.equal((await call('DELETE', `/api/teams/${team.id}/members/${alice.userId}`, null, alice.token)).status, 400)
})
