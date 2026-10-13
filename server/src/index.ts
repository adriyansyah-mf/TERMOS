import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import { App, HttpError, loadSecret, readBody, send, type Config } from './app.ts'
import { openDb } from './db.ts'
import { Relay } from './relay.ts'

const PORT = Number(process.env.TERMOS_PORT ?? 8080)
const HOST = process.env.TERMOS_HOST ?? '0.0.0.0'
const DB_PATH = process.env.TERMOS_DB ?? './data/termos.db'
const SIGNUP = (process.env.TERMOS_SIGNUP ?? 'first') as Config['signup']
// Behind a reverse proxy the client IP comes from X-Forwarded-For; only trust it when told to.
const TRUST_PROXY = process.env.TERMOS_TRUST_PROXY === '1'

if (!['first', 'open', 'invite'].includes(SIGNUP)) {
  console.error('TERMOS_SIGNUP harus first, open, atau invite')
  process.exit(1)
}
if (SIGNUP === 'invite' && !process.env.TERMOS_INVITE_CODE) {
  console.error('TERMOS_SIGNUP=invite butuh TERMOS_INVITE_CODE')
  process.exit(1)
}

const db = openDb(DB_PATH)
const app = new App(db, { signup: SIGNUP, inviteCode: process.env.TERMOS_INVITE_CODE, secret: loadSecret(db) })
const relay = new Relay()

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? '?'
}

type Handler = (req: IncomingMessage, m: RegExpExecArray, url: URL) => Promise<unknown> | unknown

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/status$/, () => ({ ...app.status(), version: '0.1.0', shares: relay.count() })],
  ['POST', /^\/api\/prelogin$/, async (req) => app.prelogin(await readBody(req))],
  ['POST', /^\/api\/register$/, async (req) => app.register(await readBody(req))],
  ['POST', /^\/api\/login$/, async (req) => app.login(await readBody(req), clientIp(req))],
  ['GET', /^\/api\/me$/, (req) => app.me(app.authenticate(req.headers.authorization))],
  ['POST', /^\/api\/logout$/, (req) => app.logout(app.authenticate(req.headers.authorization))],
  [
    'POST',
    /^\/api\/password$/,
    async (req) => app.changePassword(app.authenticate(req.headers.authorization), await readBody(req))
  ],
  ['GET', /^\/api\/devices$/, (req) => app.devices(app.authenticate(req.headers.authorization))],
  [
    'DELETE',
    /^\/api\/devices\/([\w-]+)$/,
    (req, m) => app.revokeDevice(app.authenticate(req.headers.authorization), m[1])
  ],
  ['GET', /^\/api\/invite$/, (req) => app.createInvite(app.authenticate(req.headers.authorization))],
  [
    'GET',
    /^\/api\/sync$/,
    (req, _m, url) =>
      app.pull(
        app.authenticate(req.headers.authorization),
        Number(url.searchParams.get('since') ?? 0) || 0,
        url.searchParams.get('scope') ?? undefined
      )
  ],
  ['POST', /^\/api\/sync$/, async (req) => app.push(app.authenticate(req.headers.authorization), await readBody(req))],
  ['GET', /^\/api\/teams$/, (req) => app.teamsOf(app.authenticate(req.headers.authorization).user.id)],
  ['POST', /^\/api\/teams$/, async (req) => app.createTeam(app.authenticate(req.headers.authorization), await readBody(req))],
  [
    'DELETE',
    /^\/api\/teams\/([\w-]+)$/,
    (req, m) => app.deleteTeam(app.authenticate(req.headers.authorization), m[1])
  ],
  [
    'GET',
    /^\/api\/teams\/([\w-]+)\/members$/,
    (req, m) => app.members(app.authenticate(req.headers.authorization), m[1])
  ],
  [
    'POST',
    /^\/api\/teams\/([\w-]+)\/members$/,
    async (req, m) => app.addMember(app.authenticate(req.headers.authorization), m[1], await readBody(req))
  ],
  [
    'DELETE',
    /^\/api\/teams\/([\w-]+)\/members\/([\w-]+)$/,
    (req, m) => app.removeMember(app.authenticate(req.headers.authorization), m[1], m[2])
  ],
  [
    'GET',
    /^\/api\/users\/([\w.-]+)\/key$/,
    (req, m) => {
      app.authenticate(req.headers.authorization)
      return app.publicKeyOf(m[1])
    }
  ]
]

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  for (const [method, re, fn] of routes) {
    const m = re.exec(url.pathname)
    if (!m) continue
    if (req.method !== method) continue
    try {
      const out = await fn(req, m, url)
      send(res, 200, out ?? { ok: true })
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message })
      else {
        console.error(err)
        send(res, 500, { error: 'Kesalahan server' })
      }
    }
    return
  }
  send(res, 404, { error: 'Tidak ditemukan' })
}

const server = createServer((req, res) => void handle(req, res))

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let user
  try {
    user = app.authenticate(req.headers.authorization).user
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const join = /^\/api\/share\/join\/([\w-]+)$/.exec(url.pathname)
  if (url.pathname !== '/api/share/host' && !join) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (join) relay.join(ws, join[1], user.username)
    else relay.host(ws, user.id)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`termos-server listening on ${HOST}:${PORT} (db ${DB_PATH}, signup ${SIGNUP})`)
})

const stop = (): void => {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
