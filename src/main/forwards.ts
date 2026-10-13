import { EventEmitter } from 'node:events'
import { connect as netConnect, createServer, type Server, type Socket } from 'node:net'
import type { ForwardRule, ForwardStatus, Host } from '../shared/types'
import { connectSsh, type SshConnection } from './ssh/connect'
import { sessions } from './sessions/manager'
import { vault } from './vault'

interface Running {
  rule: ForwardRule
  conn: SshConnection
  /** Owned connections are closed with the rule; borrowed ones belong to a terminal session. */
  owned: boolean
  server?: Server
  stop(): void
}

class Forwards extends EventEmitter {
  private running = new Map<string, Running>()
  private errors = new Map<string, string>()

  status(): ForwardStatus[] {
    return vault.list<ForwardRule>('forwardRules').map((r) => ({
      ruleId: r.id,
      active: this.running.has(r.id),
      error: this.errors.get(r.id)
    }))
  }

  private changed(): void {
    this.emit('status', this.status())
  }

  async start(ruleId: string, existing?: SshConnection): Promise<void> {
    if (this.running.has(ruleId)) return
    const rule = vault.find<ForwardRule>('forwardRules', ruleId)
    if (!rule) throw new Error('Aturan forwarding tidak ditemukan')
    this.errors.delete(ruleId)
    let conn = existing
    try {
      if (!conn) {
        const host = vault.find<Host>('hosts', rule.hostId)
        const ctx = sessions.create(`forward:${rule.label}`, rule.hostId)
        conn = await connectSsh(rule.hostId, ctx)
        sessions.close(ctx.id)
        if (!host) throw new Error('Host forwarding tidak ditemukan')
      }
      const running = await this.open(rule, conn, !existing)
      this.running.set(ruleId, running)
      conn.client.once('close', () => {
        if (this.running.get(ruleId) === running) {
          running.server?.close()
          this.running.delete(ruleId)
          this.errors.set(ruleId, 'Koneksi SSH terputus')
          this.changed()
        }
      })
    } catch (err) {
      if (conn && !existing) conn.close()
      this.errors.set(ruleId, err instanceof Error ? err.message : String(err))
      this.changed()
      throw err
    }
    this.changed()
  }

  stop(ruleId: string): void {
    const r = this.running.get(ruleId)
    if (!r) return
    this.running.delete(ruleId)
    r.stop()
    this.changed()
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id)
  }

  private listen(server: Server, rule: ForwardRule): Promise<void> {
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(rule.bindPort, rule.bindAddress || '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  }

  private async open(rule: ForwardRule, conn: SshConnection, owned: boolean): Promise<Running> {
    const client = conn.client
    const finish = (server?: Server, extra?: () => void): Running => ({
      rule,
      conn,
      owned,
      server,
      stop: () => {
        server?.close()
        extra?.()
        if (owned) conn.close()
      }
    })

    if (rule.type === 'local') {
      if (!rule.destHost || !rule.destPort) throw new Error('Tujuan forwarding belum diisi')
      const server = createServer((sock) => {
        client.forwardOut(
          sock.remoteAddress ?? '127.0.0.1',
          sock.remotePort ?? 0,
          rule.destHost!,
          rule.destPort!,
          (err, ch) => {
            if (err) {
              sock.destroy()
              return
            }
            sock.pipe(ch).pipe(sock)
            ch.on('error', () => sock.destroy())
            sock.on('error', () => ch.close())
          }
        )
      })
      await this.listen(server, rule)
      return finish(server)
    }

    if (rule.type === 'remote') {
      if (!rule.destHost || !rule.destPort) throw new Error('Tujuan forwarding belum diisi')
      const bind = rule.bindAddress || '127.0.0.1'
      await new Promise<void>((resolve, reject) =>
        client.forwardIn(bind, rule.bindPort, (err) => (err ? reject(err) : resolve()))
      )
      const onConn = (
        info: { destIP: string; destPort: number },
        accept: () => import('ssh2').ClientChannel
      ): void => {
        if (info.destPort !== rule.bindPort) return
        const ch = accept()
        const sock = netConnect({ host: rule.destHost!, port: rule.destPort! })
        sock.on('connect', () => sock.pipe(ch).pipe(sock))
        sock.on('error', () => ch.close())
        ch.on('error', () => sock.destroy())
      }
      client.on('tcp connection', onConn as never)
      return finish(undefined, () => {
        client.off('tcp connection', onConn as never)
        client.unforwardIn(bind, rule.bindPort, () => {})
      })
    }

    // Dynamic: a small SOCKS5 server (CONNECT, no auth) that tunnels through SSH.
    const server = createServer((sock) => socks5(sock, client))
    await this.listen(server, rule)
    return finish(server)
  }
}

function socks5(sock: Socket, client: SshConnection['client']): void {
  let stage: 'greet' | 'request' = 'greet'
  let buf = Buffer.alloc(0)
  const fail = (code: number): void => {
    sock.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))
  }
  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk])
    if (stage === 'greet') {
      if (buf.length < 2) return
      const n = buf[1]
      if (buf.length < 2 + n) return
      if (buf[0] !== 5) return void sock.destroy()
      buf = buf.subarray(2 + n)
      sock.write(Buffer.from([5, 0]))
      stage = 'request'
    }
    if (stage === 'request') {
      if (buf.length < 5) return
      const [ver, cmd, , atyp] = buf
      if (ver !== 5) return void sock.destroy()
      let host: string
      let off: number
      if (atyp === 1) {
        if (buf.length < 10) return
        host = [...buf.subarray(4, 8)].join('.')
        off = 8
      } else if (atyp === 3) {
        const len = buf[4]
        if (buf.length < 5 + len + 2) return
        host = buf.subarray(5, 5 + len).toString()
        off = 5 + len
      } else if (atyp === 4) {
        if (buf.length < 22) return
        const parts: string[] = []
        for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16))
        host = parts.join(':')
        off = 20
      } else return fail(8)
      const port = buf.readUInt16BE(off)
      const rest = buf.subarray(off + 2)
      sock.off('data', onData)
      if (cmd !== 1) return fail(7)
      sock.pause()
      client.forwardOut('127.0.0.1', 0, host, port, (err, ch) => {
        if (err) return fail(5)
        sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        if (rest.length) ch.write(rest)
        sock.pipe(ch).pipe(sock)
        sock.resume()
        ch.on('error', () => sock.destroy())
        sock.on('error', () => ch.close())
      })
    }
  }
  sock.on('data', onData)
  sock.on('error', () => sock.destroy())
}

export const forwards = new Forwards()

/** Start the forwarding rules attached to a host over a terminal session's connection. */
export function startHostForwards(hostId: string, conn: SshConnection): void {
  const host = vault.find<Host>('hosts', hostId)
  for (const id of host?.config.forwardRuleIds ?? []) {
    forwards.start(id, conn).catch(() => {
      /* status is reported through forwards 'status' events */
    })
  }
}
