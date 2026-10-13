import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { connect as netConnect, type Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { Client, utils, type AuthenticationType, type ConnectConfig } from 'ssh2'
import { SocksClient } from 'socks'
import { newId, resolveConfig } from '../../shared/merge'
import type {
  ConnConfig,
  Host,
  Identity,
  KnockStep,
  KnownHost,
  ProxyDef,
  SshKey
} from '../../shared/types'
import { vault } from '../vault'
import type { SessionContext } from '../sessions/manager'

export interface ResolvedHost {
  host: Host
  config: ConnConfig
  username: string
  password?: string
  key?: SshKey
}

export function resolveHost(hostOrId: string | Partial<Host>): ResolvedHost {
  const host: Host =
    typeof hostOrId === 'string'
      ? (vault.find<Host>('hosts', hostOrId) ?? fail(`Host ${hostOrId} tidak ditemukan`))
      : ({
          id: 'adhoc',
          label: hostOrId.address ?? 'adhoc',
          protocol: 'ssh',
          tags: [],
          config: {},
          updatedAt: 0,
          ...hostOrId
        } as Host)
  const config = resolveConfig(host, vault.list('groups'))
  const identity = vault.find<Identity>('identities', config.identityId)
  const key = vault.find<SshKey>('keys', config.keyId ?? identity?.keyId)
  return {
    host,
    config,
    username: config.username || identity?.username || process.env.USER || 'root',
    password: config.password || identity?.password,
    key
  }
}

function fail(msg: string): never {
  throw new Error(msg)
}

export function fingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function knock(address: string, steps: KnockStep[]): Promise<void> {
  for (const step of steps) {
    if (step.protocol === 'udp') {
      await new Promise<void>((resolve) => {
        const s = createSocket(address.includes(':') ? 'udp6' : 'udp4')
        s.send(Buffer.alloc(0), step.port, address, () => {
          s.close()
          resolve()
        })
      })
    } else {
      await new Promise<void>((resolve) => {
        const s = netConnect({ host: address, port: step.port })
        const done = (): void => {
          s.destroy()
          resolve()
        }
        s.setTimeout(300, done)
        s.on('connect', done)
        s.on('error', done)
      })
    }
    await sleep(150)
  }
  await sleep(400)
}

async function httpConnect(p: ProxyDef, host: string, port: number): Promise<Socket> {
  const sock = netConnect({ host: p.host, port: p.port })
  await new Promise<void>((res, rej) => {
    sock.once('connect', res)
    sock.once('error', rej)
  })
  const auth = p.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64')}\r\n`
    : ''
  sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`)
  const head = await new Promise<string>((res, rej) => {
    let buf = ''
    const onData = (d: Buffer): void => {
      buf += d.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end >= 0) {
        sock.off('data', onData)
        const rest = buf.slice(end + 4)
        if (rest) sock.unshift(Buffer.from(rest, 'latin1'))
        res(buf.slice(0, end))
      }
    }
    sock.on('data', onData)
    sock.once('error', rej)
  })
  if (!/^HTTP\/1\.[01] 200/.test(head)) {
    sock.destroy()
    throw new Error(`Proxy HTTP menolak CONNECT: ${head.split('\r\n')[0]}`)
  }
  return sock
}

function commandProxy(p: ProxyDef, host: string, port: number, user: string): Duplex {
  const cmd = (p.command ?? '')
    .replace(/%h/g, host)
    .replace(/%p/g, String(port))
    .replace(/%r/g, user)
  const child = spawn('/bin/sh', ['-c', cmd], { stdio: ['pipe', 'pipe', 'inherit'] })
  const duplex = Duplex.from({ readable: child.stdout, writable: child.stdin })
  duplex.on('close', () => child.kill())
  return duplex
}

async function openSocket(
  proxy: ProxyDef | undefined,
  host: string,
  port: number,
  user: string
): Promise<Duplex | undefined> {
  if (!proxy) return undefined
  switch (proxy.type) {
    case 'socks4':
    case 'socks5': {
      const { socket } = await SocksClient.createConnection({
        proxy: {
          host: proxy.host,
          port: proxy.port,
          type: proxy.type === 'socks5' ? 5 : 4,
          userId: proxy.username,
          password: proxy.password
        },
        command: 'connect',
        destination: { host, port }
      })
      return socket
    }
    case 'http':
      return httpConnect(proxy, host, port)
    case 'command':
      return commandProxy(proxy, host, port, user)
  }
}

function agentPath(): string | undefined {
  if (process.platform === 'win32') return 'pageant'
  return process.env.SSH_AUTH_SOCK
}

async function verifyHostKey(
  ctx: SessionContext | undefined,
  address: string,
  port: number,
  key: Buffer,
  strict: boolean
): Promise<boolean> {
  const parsed = utils.parseKey(key)
  const keyType = parsed instanceof Error ? 'unknown' : parsed.type
  const fp = fingerprint(key)
  const known = vault
    .list<KnownHost>('knownHosts')
    .filter((k) => k.host === address && k.port === port)
  if (known.some((k) => k.fingerprint === fp)) return true
  const changed = known.length > 0
  if (!ctx) return !strict && !changed
  const ok = await ctx.ask<boolean>({
    type: 'hostkey',
    host: address,
    port,
    keyType,
    fingerprint: fp,
    changed
  })
  if (ok) {
    for (const k of known) vault.remove('knownHosts', k.id)
    vault.upsert<KnownHost>('knownHosts', {
      id: newId(),
      host: address,
      port,
      keyType,
      fingerprint: fp,
      key: key.toString('base64'),
      updatedAt: Date.now()
    })
  }
  return ok
}

/** Connect one hop. `sock` is a pre-opened stream (proxy or previous jump). */
function connectHop(
  r: ResolvedHost,
  sock: Duplex | undefined,
  ctx: SessionContext | undefined
): Promise<Client> {
  const { host, config } = r
  const port = config.port ?? 22
  const client = new Client()
  const agent = config.useAgent !== false ? agentPath() : undefined

  const attempts: AuthenticationType[] = []
  if (r.key) attempts.push('publickey')
  if (agent) attempts.push('agent')
  if (r.password) attempts.push('password')
  attempts.push('keyboard-interactive')
  let askedPassword = false

  const cfg: ConnectConfig = {
    host: sock ? undefined : host.address,
    port,
    sock: sock as ConnectConfig['sock'],
    username: r.username,
    readyTimeout: (config.timeout ?? 20) * 1000,
    keepaliveInterval: (config.keepAliveInterval ?? 30) * 1000,
    keepaliveCountMax: 3,
    agent,
    agentForward: !!config.agentForwarding && !!agent,
    tryKeyboard: true,
    hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
      verifyHostKey(ctx, host.address, port, key, config.strictHostKey ?? false).then(verify, () =>
        verify(false)
      )
    },
    authHandler: (methodsLeft, _partial, next) => {
      const allowed = (m: string): boolean =>
        !methodsLeft || methodsLeft.includes(m as AuthenticationType)
      while (attempts.length) {
        const m = attempts.shift()!
        if (m === 'publickey' && allowed('publickey') && r.key) {
          return next({
            type: 'publickey',
            username: r.username,
            key: r.key.privateKey,
            passphrase: r.key.passphrase
          } as never)
        }
        if (m === 'agent' && allowed('publickey') && agent)
          return next({ type: 'agent', username: r.username, agent } as never)
        if (m === 'password' && allowed('password') && r.password) {
          return next({ type: 'password', username: r.username, password: r.password })
        }
        if (m === 'keyboard-interactive' && allowed('keyboard-interactive')) {
          return next({
            type: 'keyboard-interactive',
            username: r.username,
            prompt: (_name, instructions, _lang, prompts, finish) => {
              if (!ctx) return finish([])
              if (
                prompts.length === 1 &&
                !prompts[0].echo &&
                r.password &&
                /password/i.test(prompts[0].prompt)
              ) {
                return finish([r.password])
              }
              ctx
                .ask<string[]>({
                  type: 'prompt',
                  title: instructions || `${r.username}@${host.address}`,
                  prompts
                })
                .then(finish)
            }
          } as never)
        }
      }
      if (!askedPassword && ctx && allowed('password')) {
        askedPassword = true
        ctx
          .ask<string[] | null>({
            type: 'prompt',
            title: `${r.username}@${host.address}`,
            prompts: [{ prompt: 'Password:', echo: false }]
          })
          .then((ans) =>
            ans?.[0]
              ? next({ type: 'password', username: r.username, password: ans[0] })
              : next(false)
          )
        return
      }
      return next(false)
    }
  }

  return new Promise((resolve, reject) => {
    client.once('ready', () => resolve(client))
    client.once('error', (err) => reject(err))
    client.connect(cfg)
  })
}

export interface SshConnection {
  client: Client
  resolved: ResolvedHost
  close(): void
}

/** Connect to a host through its proxy and jump-host chain. */
export async function connectSsh(
  target: string | Partial<Host>,
  ctx?: SessionContext
): Promise<SshConnection> {
  const final = resolveHost(target)
  const chain = (final.config.hostChain ?? []).map((id) => resolveHost(id))
  const hops = [...chain, final]
  const opened: Client[] = []
  try {
    let sock: Duplex | undefined
    for (let i = 0; i < hops.length; i++) {
      const hop = hops[i]
      const port = hop.config.port ?? 22
      if (hop.config.portKnocking?.length && i === 0)
        await knock(hop.host.address, hop.config.portKnocking)
      if (i === 0) {
        const proxy = vault.find<ProxyDef>('proxies', hop.config.proxyId)
        sock = await openSocket(proxy, hop.host.address, port, hop.username)
      }
      ctx?.emitData(
        `\x1b[90m→ ${hop.username}@${hop.host.address}:${port}${i < hops.length - 1 ? ' (jump)' : ''}\x1b[0m\r\n`
      )
      const client = await connectHop(hop, sock, ctx)
      opened.push(client)
      if (i < hops.length - 1) {
        const next = hops[i + 1]
        sock = await new Promise<Duplex>((res, rej) =>
          client.forwardOut('127.0.0.1', 0, next.host.address, next.config.port ?? 22, (err, ch) =>
            err ? rej(err) : res(ch)
          )
        )
      }
    }
    return {
      client: opened.at(-1)!,
      resolved: final,
      close: () => {
        for (const c of opened.reverse()) c.end()
      }
    }
  } catch (err) {
    for (const c of opened.reverse()) c.end()
    throw err
  }
}
