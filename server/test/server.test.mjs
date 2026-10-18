// Core flows: accounts, devices, sync, relay.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import WebSocket from 'ws'
import { account, b64, sealed, startServer, waitFor } from './helpers.mjs'

let srv
const state = {}

before(async () => {
  srv = await startServer()
})
after(() => srv.stop())

test('first account registers and becomes admin; signup then needs an invite', async () => {
  const r = await srv.call('POST', '/api/register', account('alice'))
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.isAdmin, true)
  state.alice = r.body
  assert.equal((await srv.call('POST', '/api/register', account('bob'))).status, 403)
  assert.equal((await srv.call('GET', '/api/status')).body.signup, 'invite')
})

test('login checks the auth key and returns the wrapped key material', async () => {
  const bad = await srv.call('POST', '/api/login', { username: 'alice', authKey: b64(Buffer.alloc(32, 7)) })
  assert.equal(bad.status, 401)
  const ok = await srv.call('POST', '/api/login', { username: 'ALICE', authKey: account('alice').authKey, deviceName: 'laptop 2' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.wrappedKey.ct, 'wrapped-alice')
  state.alice2 = ok.body
  assert.equal((await srv.call('GET', '/api/devices', undefined, ok.body.token)).body.length, 2)
})

test('prelogin answers the same shape for unknown users', async () => {
  const known = await srv.call('POST', '/api/prelogin', { username: 'alice' })
  const unknown = await srv.call('POST', '/api/prelogin', { username: 'ghost' })
  assert.deepEqual(Object.keys(known.body.kdf).sort(), Object.keys(unknown.body.kdf).sort())
  assert.deepEqual(unknown.body, (await srv.call('POST', '/api/prelogin', { username: 'ghost' })).body)
})

test('login is rate limited per account', async () => {
  let last
  for (let i = 0; i < 11; i++)
    last = await srv.call('POST', '/api/login', { username: 'ratelimit', authKey: b64(Buffer.alloc(32)) })
  assert.equal(last.status, 429)
})

test('sync: push, pull, last-writer-wins, scope isolation', async () => {
  const t = state.alice.token
  const scope = `u:${state.alice.userId}`
  assert.equal((await srv.call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 100, blob: 'cipher-1' }] }, t)).body.accepted, 1)
  assert.deepEqual((await srv.call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 50, blob: 'old' }] }, t)).body.stale, ['h1'])
  assert.deepEqual((await srv.call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 100, blob: 'same-time' }] }, t)).body.stale, ['h1'])
  assert.equal((await srv.call('POST', '/api/sync', { records: [{ scope, id: 'h1', updatedAt: 200, blob: 'cipher-2', deleted: true }] }, t)).body.accepted, 1)

  const pull = (await srv.call('GET', '/api/sync?since=0', undefined, state.alice2.token)).body
  assert.equal(pull.records.length, 1)
  assert.equal(pull.records[0].blob, 'cipher-2')
  assert.equal(pull.records[0].deleted, true)
  assert.equal((await srv.call('GET', `/api/sync?since=${pull.cursor}`, undefined, t)).body.records.length, 0)

  assert.equal((await srv.call('POST', '/api/sync', { records: [{ scope: 'u:someone-else', id: 'x', updatedAt: 1, blob: 'b' }] }, t)).status, 403)
  assert.equal((await srv.call('GET', '/api/sync?since=0&scope=t:not-mine', undefined, t)).status, 403)
})

test('cursor never skips rows written by concurrent pushes', async () => {
  const t = state.alice.token
  const scope = `u:${state.alice.userId}`
  const start = (await srv.call('GET', '/api/sync?since=0', undefined, t)).body.cursor
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      srv.call('POST', '/api/sync', { records: [{ scope, id: `c${i}`, updatedAt: 1000 + i, blob: `b${i}` }] }, t)
    )
  )
  const seen = new Set()
  let cursor = start
  for (let round = 0; round < 5; round++) {
    const r = (await srv.call('GET', `/api/sync?since=${cursor}`, undefined, t)).body
    for (const rec of r.records) seen.add(rec.id)
    cursor = r.cursor
  }
  assert.equal([...seen].filter((id) => id.startsWith('c')).length, 20)
})

test('teams: owner creates a team and syncs team-scoped records across devices', async () => {
  const t = state.alice.token
  const team = await srv.call('POST', '/api/teams', { name: 'Ops', wrappedTeamKey: sealed('k') }, t)
  assert.equal(team.status, 200)
  const scope = `t:${team.body.id}`
  assert.equal((await srv.call('POST', '/api/sync', { records: [{ scope, id: 'th1', updatedAt: 10, blob: 'team-cipher' }] }, t)).body.accepted, 1)
  const only = await srv.call('GET', `/api/sync?since=0&scope=${encodeURIComponent(scope)}`, undefined, state.alice2.token)
  assert.deepEqual(only.body.records.map((r) => r.id), ['th1'])
  const me = await srv.call('GET', '/api/me', undefined, t)
  assert.equal(me.body.teams[0].name, 'Ops')
  assert.equal(me.body.teams[0].role, 'owner')
  assert.equal((await srv.call('GET', '/api/users/nobody/key', undefined, t)).status, 404)
})

test('revoked device token stops working', async () => {
  const devs = await srv.call('GET', '/api/devices', undefined, state.alice.token)
  const other = devs.body.find((d) => !d.current)
  await srv.call('DELETE', `/api/devices/${other.id}`, undefined, state.alice.token)
  assert.equal((await srv.call('GET', '/api/me', undefined, state.alice2.token)).status, 401)
})

test('share relay forwards host output to viewers and viewer input to the host', async () => {
  const headers = { Authorization: `Bearer ${state.alice.token}` }
  const host = new WebSocket(`ws://127.0.0.1:${srv.port}/api/share/host`, { headers })
  const hostMsgs = []
  host.on('message', (m) => hostMsgs.push(JSON.parse(m.toString())))
  await new Promise((r) => host.once('open', r))
  await waitFor(() => hostMsgs.some((m) => m.t === 'ready'))
  const shareId = hostMsgs.find((m) => m.t === 'ready').shareId

  const viewer = new WebSocket(`ws://127.0.0.1:${srv.port}/api/share/join/${shareId}`, { headers })
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

  const anon = new WebSocket(`ws://127.0.0.1:${srv.port}/api/share/host`)
  assert.equal(await new Promise((r) => anon.once('unexpected-response', (_q, res) => r(res.statusCode))), 401)
})
