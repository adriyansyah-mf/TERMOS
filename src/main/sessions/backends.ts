import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect as netConnect, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { SerialPort } from 'serialport'
import type { ClientChannel } from 'ssh2'
import type { Host, OpenSessionRequest, ProxmoxServer, Snippet } from '../../shared/types'
import { connectSsh, resolveHost, type ResolvedHost } from '../ssh/connect'
import { startHostForwards } from '../forwards'
import { proxmoxClient } from '../proxmox'
import { vault } from '../vault'
import { sessions, type Backend, type SessionContext } from './manager'

export interface OpenedSession {
  sessionId: string
  label: string
}

/** Streaming decoder that tolerates unknown charsets by falling back to UTF-8. */
function decoder(charset?: string): (chunk: Buffer) => string {
  let d: TextDecoder
  try {
    d = new TextDecoder(charset || 'utf-8')
  } catch {
    d = new TextDecoder('utf-8')
  }
  return (chunk) => d.decode(chunk, { stream: true })
}

function encoder(charset?: string): (s: string) => Buffer {
  const latin = /^(latin1|iso-?8859-?1|windows-1252|cp1252)$/i.test(charset ?? '')
  return (s) => Buffer.from(s, latin ? 'latin1' : 'utf8')
}

function startupScript(snippetId?: string): string | undefined {
  const s = vault.find<Snippet>('snippets', snippetId)
  return s?.script
}

function touchHost(host: Host): void {
  if (host.id === 'adhoc' || !vault.find('hosts', host.id)) return
  vault.upsert<Host>('hosts', { ...host, lastConnectedAt: Date.now() })
}

// ── SSH (built-in engine) ────────────────────────────────────────────────────

async function sshBackend(
  ctx: SessionContext,
  target: string | Partial<Host>,
  cols: number,
  rows: number,
  afterConnect?: string
): Promise<Backend> {
  const conn = await connectSsh(target, ctx)
  const { config } = conn.resolved
  const env: Record<string, string> = {}
  for (const e of config.env ?? []) if (e.key) env[e.key] = e.value
  const stream = await new Promise<ClientChannel>((resolve, reject) =>
    conn.client.shell({ term: 'xterm-256color', cols, rows }, { env }, (err, ch) =>
      err ? reject(err) : resolve(ch)
    )
  )
  const decode = decoder(config.charset)
  const encode = encoder(config.charset)
  stream.on('data', (d: Buffer) => ctx.emitData(decode(d)))
  stream.stderr.on('data', (d: Buffer) => ctx.emitData(decode(d)))
  stream.on('close', () => {
    conn.close()
    ctx.setStatus('closed')
  })
  conn.client.on('error', (err) => ctx.setStatus('error', err.message))

  const startup = startupScript(config.startupSnippetId)
  if (startup) stream.write(encode(startup.replace(/\r?\n/g, '\r') + '\r'))
  if (afterConnect) stream.write(encode(afterConnect + '\r'))
  if (target && typeof target === 'string' && config.forwardRuleIds?.length)
    startHostForwards(target, conn)

  return {
    write: (data) => stream.write(encode(data)),
    resize: (c, r) => stream.setWindow(r, c, 0, 0),
    close: () => {
      stream.close()
      conn.close()
    }
  }
}

// ── PTY-based backends: local shell, system OpenSSH, mosh ───────────────────

function ptyBackend(
  ctx: SessionContext,
  file: string,
  args: string[],
  cols: number,
  rows: number,
  cleanup?: () => void,
  charset?: string
): Backend {
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: homedir(),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<
      string,
      string
    >,
    encoding: charset && !/^utf-?8$/i.test(charset) ? charset : 'utf8'
  })
  proc.onData((d) => ctx.emitData(d))
  proc.onExit(({ exitCode }) => {
    cleanup?.()
    ctx.emitData(`\r\n\x1b[90m[proses selesai, kode ${exitCode}]\x1b[0m\r\n`)
    ctx.setStatus('closed')
  })
  return {
    write: (d) => proc.write(d),
    resize: (c, r) => {
      try {
        proc.resize(c, r)
      } catch {
        /* process already gone */
      }
    },
    close: () => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
      cleanup?.()
    }
  }
}

function localShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

/** Write a vault key to a private temp file for the system ssh binary. */
function tempKeyFile(r: ResolvedHost): { args: string[]; cleanup: () => void } {
  if (!r.key) return { args: [], cleanup: () => {} }
  const dir = mkdtempSync(join(tmpdir(), 'termos-'))
  chmodSync(dir, 0o700)
  const keyPath = join(dir, 'id')
  writeFileSync(
    keyPath,
    r.key.privateKey.endsWith('\n') ? r.key.privateKey : r.key.privateKey + '\n',
    {
      mode: 0o600
    }
  )
  const args = ['-i', keyPath, '-o', 'IdentitiesOnly=yes']
  if (r.key.certificate) {
    writeFileSync(keyPath + '-cert.pub', r.key.certificate, { mode: 0o600 })
    args.push('-o', `CertificateFile=${keyPath}-cert.pub`)
  }
  // ssh reads the key at startup; remove it shortly after so it does not linger on disk.
  const timer = setTimeout(() => rmSync(dir, { recursive: true, force: true }), 15000)
  return {
    args,
    cleanup: () => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

function opensshArgs(r: ResolvedHost): string[] {
  const { config, host } = r
  const args = ['-p', String(config.port ?? 22), '-l', r.username]
  if (config.agentForwarding) args.push('-A')
  args.push('-o', `ServerAliveInterval=${config.keepAliveInterval ?? 30}`)
  if (config.hostChain?.length) {
    const jumps = config.hostChain.map((id) => {
      const j = resolveHost(id)
      return `${j.username}@${j.host.address}:${j.config.port ?? 22}`
    })
    args.push('-J', jumps.join(','))
  }
  for (const e of config.env ?? []) if (e.key) args.push('-o', `SetEnv=${e.key}=${e.value}`)
  args.push(host.address)
  return args
}

// ── Telnet ───────────────────────────────────────────────────────────────────

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240
const OPT_ECHO = 1
const OPT_SGA = 3
const OPT_TTYPE = 24
const OPT_NAWS = 31

function telnetBackend(
  ctx: SessionContext,
  address: string,
  port: number,
  cols: number,
  rows: number,
  charset?: string
): Promise<Backend> {
  return new Promise((resolve, reject) => {
    const sock: Socket = netConnect({ host: address, port })
    const decode = decoder(charset)
    const encode = encoder(charset)
    let size = { cols, rows }
    let nawsOn = false
    let pending = Buffer.alloc(0)

    const sendNaws = (): void => {
      if (!nawsOn) return
      const b = Buffer.alloc(4)
      b.writeUInt16BE(size.cols, 0)
      b.writeUInt16BE(size.rows, 2)
      const escaped: number[] = []
      for (const x of b) escaped.push(...(x === IAC ? [IAC, IAC] : [x]))
      sock.write(Buffer.from([IAC, SB, OPT_NAWS, ...escaped, IAC, SE]))
    }

    const handle = (chunk: Buffer): void => {
      const buf = Buffer.concat([pending, chunk])
      pending = Buffer.alloc(0)
      const out: number[] = []
      let i = 0
      while (i < buf.length) {
        const b = buf[i]
        if (b !== IAC) {
          out.push(b)
          i++
          continue
        }
        if (i + 1 >= buf.length) {
          pending = buf.subarray(i)
          break
        }
        const cmd = buf[i + 1]
        if (cmd === IAC) {
          out.push(IAC)
          i += 2
        } else if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
          if (i + 2 >= buf.length) {
            pending = buf.subarray(i)
            break
          }
          const opt = buf[i + 2]
          if (cmd === DO) {
            if (opt === OPT_NAWS) {
              sock.write(Buffer.from([IAC, WILL, OPT_NAWS]))
              nawsOn = true
              sendNaws()
            } else if (opt === OPT_TTYPE) sock.write(Buffer.from([IAC, WILL, OPT_TTYPE]))
            else sock.write(Buffer.from([IAC, WONT, opt]))
          } else if (cmd === WILL) {
            sock.write(Buffer.from([IAC, opt === OPT_ECHO || opt === OPT_SGA ? DO : DONT, opt]))
          }
          i += 3
        } else if (cmd === SB) {
          const end = buf.indexOf(Buffer.from([IAC, SE]), i + 2)
          if (end < 0) {
            pending = buf.subarray(i)
            break
          }
          // Terminal type request: IAC SB TTYPE SEND IAC SE
          if (buf[i + 2] === OPT_TTYPE && buf[i + 3] === 1) {
            sock.write(
              Buffer.concat([
                Buffer.from([IAC, SB, OPT_TTYPE, 0]),
                Buffer.from('XTERM-256COLOR'),
                Buffer.from([IAC, SE])
              ])
            )
          }
          i = end + 2
        } else {
          i += 2
        }
      }
      if (out.length) ctx.emitData(decode(Buffer.from(out)))
    }

    sock.once('connect', () => {
      sock.on('data', handle)
      resolve({
        write: (d) => {
          const raw = encode(d)
          const esc: number[] = []
          for (const x of raw) esc.push(...(x === IAC ? [IAC, IAC] : [x]))
          sock.write(Buffer.from(esc))
        },
        resize: (c, r) => {
          size = { cols: c, rows: r }
          sendNaws()
        },
        close: () => sock.destroy()
      })
    })
    sock.once('error', reject)
    sock.on('close', () => ctx.setStatus('closed'))
  })
}

// ── Serial ───────────────────────────────────────────────────────────────────

function serialBackend(ctx: SessionContext, path: string, baudRate: number): Promise<Backend> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, autoOpen: false })
    const decode = decoder()
    port.open((err) => {
      if (err) return reject(err)
      port.on('data', (d: Buffer) => ctx.emitData(decode(d)))
      port.on('close', () => ctx.setStatus('closed'))
      port.on('error', (e) => ctx.setStatus('error', e.message))
      resolve({
        write: (d) => port.write(d),
        resize: () => {},
        close: () => port.isOpen && port.close()
      })
    })
  })
}

export async function listSerialPorts(): Promise<{ path: string; label: string }[]> {
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    label: [p.path, p.manufacturer, p.serialNumber].filter(Boolean).join(' · ')
  }))
}

// ── Session entry point ──────────────────────────────────────────────────────

async function connectHost(
  ctx: SessionContext,
  target: string | Partial<Host>,
  cols: number,
  rows: number,
  afterConnect?: string
): Promise<Backend> {
  const r = resolveHost(target)
  const { host, config } = r
  switch (host.protocol) {
    case 'local':
      return ptyBackend(ctx, localShell(), [], cols, rows)
    case 'telnet':
      ctx.emitData(`\x1b[90m→ telnet ${host.address}:${config.port ?? 23}\x1b[0m\r\n`)
      return telnetBackend(ctx, host.address, config.port ?? 23, cols, rows, config.charset)
    case 'serial': {
      const s = host.serial ?? { path: host.address, baudRate: 9600 }
      ctx.emitData(`\x1b[90m→ serial ${s.path} @ ${s.baudRate}\x1b[0m\r\n`)
      return serialBackend(ctx, s.path, s.baudRate)
    }
    case 'mosh': {
      const key = tempKeyFile(r)
      const sshCmd = ['ssh', '-p', String(config.port ?? 22), ...key.args].join(' ')
      const args = [`--ssh=${sshCmd}`, `${r.username}@${host.address}`]
      return ptyBackend(ctx, config.moshCommand || 'mosh', args, cols, rows, key.cleanup)
    }
    case 'ssh':
    default:
      if (config.engine === 'openssh') {
        const key = tempKeyFile(r)
        const args = [...key.args, ...opensshArgs(r)]
        if (afterConnect) args.push('-t', afterConnect)
        return ptyBackend(ctx, 'ssh', args, cols, rows, key.cleanup, config.charset)
      }
      return sshBackend(ctx, target, cols, rows, afterConnect)
  }
}

async function proxmoxTarget(
  serverId: string,
  node: string,
  vmType?: 'qemu' | 'lxc',
  vmid?: number
): Promise<{ target: string | Partial<Host>; command?: string; label: string }> {
  const server = vault.find<ProxmoxServer>('proxmox', serverId)
  if (!server) throw new Error('Server Proxmox tidak ditemukan')
  let target: string | Partial<Host>
  if (server.sshHostId && vault.find('hosts', server.sshHostId)) {
    target = server.sshHostId
  } else {
    const address = (await proxmoxClient(server).nodeAddress(node)) ?? new URL(server.url).hostname
    target = { label: node, address, protocol: 'ssh', config: { username: 'root' } }
  }
  if (vmid && vmType === 'lxc')
    return { target, command: `pct enter ${vmid}`, label: `${node} › CT ${vmid}` }
  if (vmid && vmType === 'qemu')
    return { target, command: `qm terminal ${vmid}`, label: `${node} › VM ${vmid}` }
  return { target, label: node }
}

export async function openSession(req: OpenSessionRequest): Promise<OpenedSession> {
  const { target, cols, rows } = req
  let label = 'Sesi'
  let resolvedTarget: string | Partial<Host>
  let afterConnect: string | undefined
  let hostId: string | undefined

  if (target.kind === 'host') {
    const host = vault.find<Host>('hosts', target.hostId)
    if (!host) throw new Error('Host tidak ditemukan')
    label = host.label
    hostId = host.id
    resolvedTarget = host.id
  } else if (target.kind === 'adhoc') {
    label = target.host.label || target.host.address || 'Sesi'
    resolvedTarget = target.host
  } else if (target.kind === 'proxmox') {
    const p = await proxmoxTarget(target.serverId, target.node, target.vmType, target.vmid)
    label = p.label
    resolvedTarget = p.target
    afterConnect = p.command
  } else {
    throw new Error('Jenis sesi ini belum didukung')
  }

  const logSession = resolveHost(resolvedTarget).config.logSession ?? false
  const ctx = sessions.create(label, hostId, logSession)
  ctx.setStatus('connecting')
  // Connect in the background so the renderer can render the tab and answer prompts.
  void (async () => {
    try {
      const backend = await connectHost(ctx, resolvedTarget, cols, rows, afterConnect)
      sessions.setBackend(ctx.id, backend)
      ctx.setStatus('connected')
      if (hostId) touchHost(resolveHost(hostId).host)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.emitData(`\r\n\x1b[31m✖ ${msg}\x1b[0m\r\n`)
      ctx.setStatus('error', msg)
      sessions.ended(ctx.id)
    }
  })()
  return { sessionId: ctx.id, label }
}
