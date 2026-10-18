// Server administration: invites, sign-up mode, user management. Default TERMOS_SIGNUP=first.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { account, startServer } from './helpers.mjs'

let srv
const u = {}
before(async () => {
  srv = await startServer({ TERMOS_SIGNUP_PER_HOUR: '50' })
  u.root = (await srv.call('POST', '/api/register', account('root'))).body
})
after(() => srv.stop())

const call = (...a) => srv.call(...a)
const invite = async (body = {}) => (await call('POST', '/api/admin/invites', body, u.root.token)).body

test('after the first account, sign-up needs a single-use invite', async () => {
  assert.equal((await call('GET', '/api/status')).body.signup, 'invite')
  const none = await call('POST', '/api/register', account('nocode'))
  assert.equal(none.status, 403)
  const inv = await invite({ note: 'for bob' })
  assert.match(inv.code, /^[\w-]{20}$/)
  const bob = await call('POST', '/api/register', account('bob', { inviteCode: ` ${inv.code} ` }))
  assert.equal(bob.status, 200, JSON.stringify(bob.body))
  assert.equal(bob.body.isAdmin, false)
  u.bob = bob.body
  // The same code does not work twice.
  assert.equal((await call('POST', '/api/register', account('carl', { inviteCode: inv.code }))).status, 403)
  const list = (await call('GET', '/api/admin', undefined, u.root.token)).body.invites
  const used = list.find((i) => i.id === inv.id)
  assert.equal(used.usedBy, 'bob')
  assert.equal(used.note, 'for bob')
  assert.ok(!('code' in used) && !('code_hash' in used))
})

test('a used invite stays used after its account is deleted', async () => {
  const inv = await invite()
  const tmp = (await call('POST', '/api/register', account('tmp', { inviteCode: inv.code }))).body
  assert.equal((await call('DELETE', `/api/admin/users/${tmp.userId}`, undefined, u.root.token)).status, 200)
  assert.equal((await call('POST', '/api/register', account('tmp2', { inviteCode: inv.code }))).status, 403)
})

test('revoked and invalid invites are refused; bad lifetimes are rejected', async () => {
  const inv = await invite()
  assert.equal((await call('DELETE', `/api/admin/invites/${inv.id}`, undefined, u.root.token)).status, 200)
  assert.equal((await call('POST', '/api/register', account('dan', { inviteCode: inv.code }))).status, 403)
  assert.equal((await call('POST', '/api/register', account('dan', { inviteCode: 'x'.repeat(20) }))).status, 403)
  for (const hours of [0, 721, 1.5, 'abc'])
    assert.equal((await call('POST', '/api/admin/invites', { hours }, u.root.token)).status, 400)
})

test('non-admins get 403 on every admin endpoint', async () => {
  const t = u.bob.token
  const id = u.root.userId
  for (const [m, p, b] of [
    ['GET', '/api/admin'],
    ['PUT', '/api/admin/signup', { mode: 'open' }],
    ['POST', '/api/admin/invites', {}],
    ['DELETE', `/api/admin/users/${id}`],
    ['DELETE', `/api/admin/users/${id}/devices`],
    ['PUT', `/api/admin/users/${u.bob.userId}/admin`, { isAdmin: true }]
  ])
    assert.equal((await call(m, p, b, t)).status, 403, `${m} ${p}`)
})

test('admin switches sign-up mode at runtime and back to the default', async () => {
  const set = (mode) => call('PUT', '/api/admin/signup', { mode }, u.root.token)
  assert.equal((await set('open')).status, 200)
  assert.equal((await call('GET', '/api/status')).body.signup, 'open')
  const eve = await call('POST', '/api/register', account('eve'))
  assert.equal(eve.status, 200)
  u.eve = eve.body
  assert.equal((await set('closed')).status, 200)
  const inv = await invite()
  // Closed means closed, even with a valid invite.
  assert.equal((await call('POST', '/api/register', account('fay', { inviteCode: inv.code }))).status, 403)
  assert.equal((await set('bogus')).status, 400)
  assert.equal((await set(null)).status, 200)
  assert.equal((await call('GET', '/api/status')).body.signup, 'invite')
  const ov = (await call('GET', '/api/admin', undefined, u.root.token)).body
  assert.equal(ov.signupSetting, null)
  assert.equal(ov.envSignup, 'first')
})

test('overview lists users with usage, without vault contents', async () => {
  await call('POST', '/api/sync', { records: [{ scope: `u:${u.bob.userId}`, id: 'r1', updatedAt: 1, blob: 'secret-cipher' }] }, u.bob.token)
  const ov = (await call('GET', '/api/admin', undefined, u.root.token)).body
  const bob = ov.users.find((x) => x.username === 'bob')
  assert.equal(bob.records, 1)
  assert.equal(bob.bytes, 'secret-cipher'.length)
  assert.equal(bob.devices, 1)
  assert.ok(ov.users.find((x) => x.username === 'root').current)
  assert.ok(!JSON.stringify(ov).includes('secret-cipher'))
  assert.ok(!JSON.stringify(ov).includes('auth_hash'))
})

test('admin signs a user out everywhere, promotes and demotes', async () => {
  assert.equal((await call('DELETE', `/api/admin/users/${u.bob.userId}/devices`, undefined, u.root.token)).status, 200)
  assert.equal((await call('GET', '/api/me', undefined, u.bob.token)).status, 401)
  const promote = await call('PUT', `/api/admin/users/${u.eve.userId}/admin`, { isAdmin: true }, u.root.token)
  assert.equal(promote.status, 200)
  assert.equal((await call('GET', '/api/me', undefined, u.eve.token)).body.isAdmin, true)
  assert.equal((await call('GET', '/api/admin', undefined, u.eve.token)).status, 200)
  // Nobody can demote themselves or delete themselves through the admin panel.
  assert.equal((await call('PUT', `/api/admin/users/${u.root.userId}/admin`, { isAdmin: false }, u.root.token)).status, 400)
  assert.equal((await call('DELETE', `/api/admin/users/${u.root.userId}`, undefined, u.root.token)).status, 400)
  assert.equal((await call('PUT', `/api/admin/users/${u.eve.userId}/admin`, { isAdmin: false }, u.root.token)).status, 200)
  assert.equal((await call('GET', '/api/admin', undefined, u.eve.token)).status, 403)
})

test('the last admin cannot delete their own account while others remain', async () => {
  const res = await call('DELETE', '/api/me', { authKey: account('root').authKey }, u.root.token)
  assert.equal(res.status, 400)
  assert.equal((await call('GET', '/api/me', undefined, u.root.token)).status, 200)
})
