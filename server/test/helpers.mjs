// Shared test harness: each test file gets its own database and server process.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const ADMIN_URL = process.env.TERMOS_TEST_DATABASE_URL
if (!ADMIN_URL) throw new Error('Run tests through test/run.sh (needs TERMOS_TEST_DATABASE_URL)')

export const b64 = (buf) => Buffer.from(buf).toString('base64')
const bytes = (seed, n) => {
  const out = Buffer.alloc(n)
  Buffer.from(seed).copy(out)
  return out
}

/** Registration payload with correctly sized fake key material. */
export function account(name, extra = {}) {
  return {
    username: name,
    authKey: b64(bytes(`auth-${name}`, 32)),
    kdf: { alg: 'argon2id', salt: b64(bytes(`salt-${name}`, 16)), m: 65536, t: 3, p: 1 },
    wrappedKey: { nonce: 'n', ct: 'wrapped-' + name },
    publicKey: b64(bytes(`pub-${name}`, 32)),
    wrappedPrivateKey: { nonce: 'n', ct: 'priv-' + name },
    deviceName: 'test',
    ...extra
  }
}

export const sealed = (ct) => ({ epk: 'e', nonce: 'n', ct })

export async function startServer(env = {}) {
  const dbName = 't_' + randomBytes(6).toString('hex')
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
  const url = new URL(ADMIN_URL)
  url.pathname = '/' + dbName

  const port = 20000 + Math.floor(Math.random() * 20000)
  const proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, TERMOS_PORT: String(port), TERMOS_HOST: '127.0.0.1', TERMOS_DATABASE_URL: url.toString(), ...env },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve, reject) => {
    proc.stdout.once('data', resolve)
    proc.once('exit', (code) => reject(new Error(`server exited ${code}`)))
  })
  const base = `http://127.0.0.1:${port}`
  async function call(method, path, body, token, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    })
    return { status: res.status, body: await res.json() }
  }
  return {
    port,
    base,
    call,
    dbUrl: url.toString(),
    async stop() {
      proc.kill()
      await new Promise((r) => proc.once('exit', r))
      const a = new pg.Client({ connectionString: ADMIN_URL })
      await a.connect()
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
      await a.end()
    }
  }
}

export async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timeout')
}
