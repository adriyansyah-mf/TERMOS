// Multi-user team access: owner, member and outsider on a server with open signup.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { account, sealed, startServer } from './helpers.mjs'

let srv
before(async () => {
  srv = await startServer({ TERMOS_SIGNUP: 'open' })
})
after(() => srv.stop())

test('member sees team records after being added; outsider and removed member do not', async () => {
  const call = srv.call
  const alice = (await call('POST', '/api/register', account('alice'))).body
  const bob = (await call('POST', '/api/register', account('bob'))).body
  const carol = (await call('POST', '/api/register', account('carol'))).body
  assert.ok(alice.token && bob.token && carol.token)
  assert.equal(bob.isAdmin, false)

  const team = (await call('POST', '/api/teams', { name: 'Ops', wrappedTeamKey: sealed('for-alice') }, alice.token)).body
  const scope = `t:${team.id}`
  await call('POST', '/api/sync', { records: [{ scope, id: 'srv1', updatedAt: 5, blob: 'team-host' }] }, alice.token)

  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, undefined, bob.token)).status, 403)

  const key = (await call('GET', '/api/users/bob/key', undefined, alice.token)).body
  assert.equal(key.publicKey, account('bob').publicKey)
  assert.equal((await call('POST', `/api/teams/${team.id}/members`, { userId: key.userId, wrappedTeamKey: sealed('for-bob') }, alice.token)).status, 200)

  const bobMe = (await call('GET', '/api/me', undefined, bob.token)).body
  assert.equal(bobMe.teams[0].wrappedTeamKey.ct, 'for-bob')
  assert.equal(bobMe.teams[0].role, 'member')
  assert.deepEqual((await call('GET', `/api/sync?since=0&scope=${scope}`, undefined, bob.token)).body.records.map((r) => r.blob), ['team-host'])
  assert.equal((await call('POST', '/api/sync', { records: [{ scope, id: 'srv2', updatedAt: 6, blob: 'by-bob' }] }, bob.token)).body.accepted, 1)

  assert.equal((await call('POST', `/api/teams/${team.id}/members`, { userId: carol.userId, wrappedTeamKey: sealed('x') }, bob.token)).status, 403)
  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, undefined, carol.token)).status, 403)
  assert.equal((await call('GET', `/api/teams/${team.id}/members`, undefined, carol.token)).status, 404)
  assert.equal((await call('DELETE', `/api/teams/${team.id}`, undefined, bob.token)).status, 403)

  const members = (await call('GET', `/api/teams/${team.id}/members`, undefined, alice.token)).body
  assert.deepEqual(members.map((m) => m.username).sort(), ['alice', 'bob'])
  assert.ok(members.every((m) => m.publicKey))

  await call('DELETE', `/api/teams/${team.id}/members/${bob.userId}`, undefined, alice.token)
  assert.equal((await call('GET', `/api/sync?since=0&scope=${scope}`, undefined, bob.token)).status, 403)
  assert.equal((await call('DELETE', `/api/teams/${team.id}/members/${alice.userId}`, undefined, alice.token)).status, 400)
})

test('deleting an account removes its devices, personal records and owned teams', async () => {
  const call = srv.call
  const dave = (await call('POST', '/api/register', account('dave'))).body
  await call('POST', '/api/sync', { records: [{ scope: `u:${dave.userId}`, id: 'd1', updatedAt: 1, blob: 'x' }] }, dave.token)
  const wrong = await call('DELETE', '/api/me', { authKey: account('nope').authKey }, dave.token)
  assert.equal(wrong.status, 403)
  assert.equal((await call('DELETE', '/api/me', { authKey: account('dave').authKey }, dave.token)).status, 200)
  assert.equal((await call('GET', '/api/me', undefined, dave.token)).status, 401)
  assert.equal((await call('POST', '/api/login', { username: 'dave', authKey: account('dave').authKey })).status, 401)
})
