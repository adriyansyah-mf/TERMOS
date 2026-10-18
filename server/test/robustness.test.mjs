// The server must survive hostile or broken clients and keep serving everyone else.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import WebSocket from 'ws'
import { account, startServer, waitFor } from './helpers.mjs'

let srv
let token
before(async () => {
  srv = await startServer({
    TERMOS_SIGNUP: 'open',
    TERMOS_TRUST_PROXY: '1',
    TERMOS_SIGNUP_PER_HOUR: '4'
  })
  token = (await srv.call('POST', '/api/register', account('robust'))).body.token
})
after(() => srv.stop())

const alive = async () => (await srv.call('GET', '/api/status')).status === 200

test('an oversized WebSocket frame closes that socket, not the server', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/share/host`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  await new Promise((r) => ws.once('open', r))
  ws.on('error', () => {})
  const closed = new Promise((r) => ws.once('close', (code) => r(code)))
  ws.send('x'.repeat(600 * 1024))
  assert.equal(await closed, 1009)
  await waitFor(alive)
  assert.ok(await alive())
})

test('a client that resets during the upgrade does not crash the server', async () => {
  const { connect } = await import('node:net')
  for (let i = 0; i < 5; i++) {
    const s = connect(srv.port, '127.0.0.1', () => {
      s.write(
        'GET /api/share/host HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer ${token}\r\n\r\n`
      )
      s.resetAndDestroy()
    })
    s.on('error', () => {})
  }
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(await alive())
})

test('rate limits key on the address the proxy saw, not a spoofed X-Forwarded-For prefix', async () => {
  // The proxy appends the real client address; whatever the client put first is untrusted.
  const reg = (spoof, n) =>
    srv.call('POST', '/api/register', account(`xff${n}`), undefined, {
      'X-Forwarded-For': `${spoof}, 203.0.113.9`
    })
  const codes = []
  for (let i = 0; i < 5; i++) codes.push((await reg(`198.51.100.${i}`, i)).status)
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200])
  assert.equal(codes[3], 429)
})

test('team names must not be blank', async () => {
  const res = await srv.call(
    'POST',
    '/api/teams',
    { name: '   ', wrappedTeamKey: { epk: 'e', nonce: 'n', ct: 'c' } },
    token
  )
  assert.equal(res.status, 400)
})
