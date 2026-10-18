import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer } from 'ws'
import { App, HttpError, loadSecret, readBody, send, type Authed, type Config } from './app.ts'
import { openDb, poolConfig } from './db.ts'
import { Relay } from './relay.ts'

const env = process.env
const PORT = Number(env.TERMOS_PORT ?? 8080)
const HOST = env.TERMOS_HOST ?? '0.0.0.0'
const SIGNUP = (env.TERMOS_SIGNUP ?? 'first') as Config['signup']
// Behind a reverse proxy the client IP comes from X-Forwarded-For; only trust it when told to.
const TRUST_PROXY = env.TERMOS_TRUST_PROXY === '1'
const VERSION = '0.2.0'

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
if (!['first', 'open', 'invite'].includes(SIGNUP))
  fail('TERMOS_SIGNUP harus first, open, atau invite')
if (SIGNUP === 'invite' && (env.TERMOS_INVITE_CODE ?? '').length < 16)
  fail('TERMOS_SIGNUP=invite butuh TERMOS_INVITE_CODE minimal 16 karakter')

const db = await openDb(poolConfig())
const app = new App(db, {
  signup: SIGNUP,
  inviteCode: env.TERMOS_INVITE_CODE,
  secret: await loadSecret(db),
  tokenIdleMs: Number(env.TERMOS_TOKEN_IDLE_DAYS ?? 90) * 86_400_000,
  maxRecords: Number(env.TERMOS_MAX_RECORDS ?? 20_000),
  maxBytes: Number(env.TERMOS_MAX_MB ?? 256) * 1024 * 1024,
  signupPerHour: Number(env.TERMOS_SIGNUP_PER_HOUR ?? 10)
})
const relay = new Relay()

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? '?'
}

type Ctx = {
  req: IncomingMessage
  m: RegExpExecArray
  url: URL
  ip: string
  body: () => Promise<Record<string, unknown>>
}
type Route = [string, RegExp, boolean, (c: Ctx, a: Authed) => Promise<unknown> | unknown]

// [method, path, needs auth, handler]
const routes: Route[] = [
  ['GET', /^\/api\/status$/, false, async () => ({ ...(await app.status()), version: VERSION })],
  ['POST', /^\/api\/prelogin$/, false, async (c) => app.prelogin(await c.body(), c.ip)],
  ['POST', /^\/api\/register$/, false, async (c) => app.register(await c.body(), c.ip)],
  ['POST', /^\/api\/login$/, false, async (c) => app.login(await c.body(), c.ip)],
  ['GET', /^\/api\/me$/, true, (_c, a) => app.me(a)],
  ['DELETE', /^\/api\/me$/, true, async (c, a) => app.deleteAccount(a, await c.body())],
  ['POST', /^\/api\/logout$/, true, (_c, a) => app.logout(a)],
  ['POST', /^\/api\/password$/, true, async (c, a) => app.changePassword(a, await c.body())],
  ['GET', /^\/api\/devices$/, true, (_c, a) => app.devices(a)],
  ['DELETE', /^\/api\/devices\/([\w-]+)$/, true, (c, a) => app.revokeDevice(a, c.m[1])],
  [
    'GET',
    /^\/api\/sync$/,
    true,
    (c, a) =>
      app.pull(
        a,
        Number(c.url.searchParams.get('since') ?? 0) || 0,
        c.url.searchParams.get('scope') ?? undefined
      )
  ],
  ['POST', /^\/api\/sync$/, true, async (c, a) => app.push(a, await c.body())],
  ['GET', /^\/api\/teams$/, true, (_c, a) => app.teamsOf(a.user.id)],
  ['POST', /^\/api\/teams$/, true, async (c, a) => app.createTeam(a, await c.body())],
  ['DELETE', /^\/api\/teams\/([\w-]+)$/, true, (c, a) => app.deleteTeam(a, c.m[1])],
  ['GET', /^\/api\/teams\/([\w-]+)\/members$/, true, (c, a) => app.members(a, c.m[1])],
  [
    'POST',
    /^\/api\/teams\/([\w-]+)\/members$/,
    true,
    async (c, a) => app.addMember(a, c.m[1], await c.body())
  ],
  [
    'DELETE',
    /^\/api\/teams\/([\w-]+)\/members\/([\w-]+)$/,
    true,
    (c, a) => app.removeMember(a, c.m[1], c.m[2])
  ],
  ['GET', /^\/api\/users\/([\w.-]+)\/key$/, true, (c) => app.publicKeyOf(c.m[1])]
]

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname))
  if (!route)
    return send(res, routes.some(([, re]) => re.test(url.pathname)) ? 405 : 404, {
      error: 'Tidak ditemukan'
    })
  const [, re, needsAuth, fn] = route
  try {
    const a = needsAuth
      ? await app.authenticate(req.headers.authorization)
      : (undefined as unknown as Authed)
    const out = await fn(
      { req, m: re.exec(url.pathname)!, url, ip: clientIp(req), body: () => readBody(req) },
      a
    )
    send(res, 200, out ?? { ok: true })
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message })
    else {
      console.error(err)
      send(res, 500, { error: 'Kesalahan server' })
    }
  }
}

const server = createServer((req, res) => void handle(req, res))
// Slow-client protection.
server.headersTimeout = 10_000
server.requestTimeout = 30_000
server.keepAliveTimeout = 5_000

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })
server.on('upgrade', (req, socket, head) => {
  const reject = (code: number, text: string): void => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }
  // Termos connects without an Origin header; a browser page always sends one.
  if (req.headers.origin) return reject(403, 'Forbidden')
  const url = new URL(req.url ?? '/', 'http://localhost')
  const join = /^\/api\/share\/join\/([\w-]{16,40})$/.exec(url.pathname)
  if (url.pathname !== '/api/share/host' && !join) return reject(404, 'Not Found')
  app.authenticate(req.headers.authorization).then(
    ({ user }) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (join) relay.join(ws, join[1], user.username)
        else relay.host(ws, user.id)
      }),
    () => reject(401, 'Unauthorized')
  )
})

server.listen(PORT, HOST, () => {
  console.log(`termos-server ${VERSION} listening on ${HOST}:${PORT} (signup ${SIGNUP})`)
})

const stop = (): void => {
  server.close()
  void db.end().finally(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
