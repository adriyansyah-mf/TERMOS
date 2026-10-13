import * as https from 'node:https'
import * as tls from 'node:tls'
import type { ProxmoxServer, PveResource } from '../shared/types'

export type GuestType = 'qemu' | 'lxc'
export type GuestAction = 'start' | 'shutdown' | 'stop' | 'reboot' | 'suspend' | 'resume'

export interface PveSnapshot {
  name: string
  description?: string
  snaptime?: number
}

export interface PveTask {
  upid: string
  type: string
  id?: string
  user: string
  status?: string
  starttime: number
  endtime?: number
}

/**
 * Errors cross IPC as plain messages, so certificate problems use a parseable prefix:
 * `UNTRUSTED_CERT|<fingerprint>|<subject>` and `CERT_CHANGED|<expected>|<actual>`.
 */
const untrusted = (fp: string, subject: string): Error =>
  new Error(`UNTRUSTED_CERT|${fp}|${subject}`)
const changed = (expected: string, actual: string): Error =>
  new Error(`CERT_CHANGED|${expected}|${actual}`)

const normalizeFp = (fp: string): string => fp.replace(/:/g, '').toUpperCase()
const formatFp = (fp: string): string => normalizeFp(fp).match(/.{2}/g)?.join(':') ?? fp

function pinnedAgent(expected: string): https.Agent {
  const agent = new https.Agent({ keepAlive: false })
  ;(agent as unknown as { createConnection: unknown }).createConnection = (
    options: tls.ConnectionOptions,
    callback: (err: Error | null, s?: tls.TLSSocket) => void
  ) => {
    const socket = tls.connect({ ...options, rejectUnauthorized: false })
    socket.once('secureConnect', () => {
      const actual = socket.getPeerCertificate().fingerprint256 ?? ''
      if (normalizeFp(actual) !== normalizeFp(expected)) {
        socket.destroy()
        callback(changed(formatFp(expected), formatFp(actual)))
        return
      }
      callback(null, socket)
    })
    socket.once('error', (err) => callback(err))
    return undefined
  }
  return agent
}

export function probeCertificate(
  baseUrl: string
): Promise<{ fingerprint: string; subject: string }> {
  const u = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: u.hostname,
      port: parseInt(u.port || '8006'),
      servername: /^[\d.:]+$/.test(u.hostname) ? undefined : u.hostname,
      rejectUnauthorized: false
    })
    socket.setTimeout(10000, () => {
      socket.destroy()
      reject(new Error('Timeout saat menghubungi server'))
    })
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      resolve({
        fingerprint: formatFp(cert.fingerprint256 ?? ''),
        subject: [cert.subject?.CN ?? ''].flat().join(', ')
      })
    })
    socket.once('error', reject)
  })
}

type Body = Record<string, string | number | boolean | undefined>

/** Password logins are cached per server so every request does not re-authenticate. */
const tickets = new Map<string, { ticket: string; csrf: string; at: number }>()

export class ProxmoxClient {
  constructor(private server: ProxmoxServer) {}

  private base(): string {
    return this.server.url.replace(/\/+$/, '')
  }

  private raw<T>(
    method: string,
    path: string,
    body?: Body,
    auth?: Record<string, string>
  ): Promise<T> {
    const u = new URL(this.base() + '/api2/json' + path)
    let payload: string | undefined
    if (body) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(body))
        if (v !== undefined) params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
      payload = params.toString()
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...auth }
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = String(Buffer.byteLength(payload))
    }
    const doRequest = (agent?: https.Agent): Promise<T> =>
      new Promise((resolve, reject) => {
        const req = https.request(
          {
            method,
            hostname: u.hostname,
            port: u.port || 8006,
            path: u.pathname + u.search,
            headers,
            agent,
            timeout: 20000
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c) => chunks.push(c))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf-8')
              if ((res.statusCode ?? 500) >= 400) {
                let msg = res.statusMessage ?? ''
                try {
                  const j = JSON.parse(text)
                  if (j.errors)
                    msg +=
                      ': ' +
                      Object.entries(j.errors)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')
                  else if (j.message) msg += ': ' + j.message
                } catch {
                  /* non-JSON error body */
                }
                reject(new Error(`HTTP ${res.statusCode} ${msg}`.trim()))
                return
              }
              try {
                resolve(JSON.parse(text).data as T)
              } catch (e) {
                reject(e)
              }
            })
          }
        )
        req.on('timeout', () => req.destroy(new Error('Request timeout')))
        req.on('error', reject)
        if (payload !== undefined) req.write(payload)
        req.end()
      })

    if (this.server.fingerprint) return doRequest(pinnedAgent(this.server.fingerprint))
    return doRequest().catch(async (err) => {
      if (err?.code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(err.code)) {
        const { fingerprint, subject } = await probeCertificate(this.base())
        throw untrusted(fingerprint, subject)
      }
      throw err
    })
  }

  private async authHeaders(method: string): Promise<Record<string, string>> {
    const s = this.server
    if (s.authType !== 'password') {
      return { Authorization: `PVEAPIToken=${s.tokenId}=${s.tokenSecret ?? ''}` }
    }
    let t = tickets.get(s.id)
    // Tickets live 2 hours; refresh a bit earlier.
    if (!t || Date.now() - t.at > 100 * 60 * 1000) {
      const user = s.username?.includes('@') ? s.username : `${s.username}@${s.realm || 'pam'}`
      const r = await this.raw<{ ticket: string; CSRFPreventionToken: string }>(
        'POST',
        '/access/ticket',
        { username: user, password: s.password ?? '' }
      )
      t = { ticket: r.ticket, csrf: r.CSRFPreventionToken, at: Date.now() }
      tickets.set(s.id, t)
    }
    const h: Record<string, string> = { Cookie: `PVEAuthCookie=${encodeURIComponent(t.ticket)}` }
    if (method !== 'GET') h.CSRFPreventionToken = t.csrf
    return h
  }

  async request<T>(method: string, path: string, body?: Body): Promise<T> {
    return this.raw<T>(method, path, body, await this.authHeaders(method))
  }

  version(): Promise<{ version: string; release: string }> {
    return this.request('GET', '/version')
  }

  resources(): Promise<PveResource[]> {
    return this.request('GET', '/cluster/resources')
  }

  guestAction(node: string, type: GuestType, vmid: number, action: GuestAction): Promise<string> {
    return this.request(
      'POST',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`,
      {}
    )
  }

  snapshots(node: string, type: GuestType, vmid: number): Promise<PveSnapshot[]> {
    return this.request<PveSnapshot[]>(
      'GET',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
    ).then((l) => l.filter((s) => s.name !== 'current'))
  }

  createSnapshot(
    node: string,
    type: GuestType,
    vmid: number,
    name: string,
    description?: string
  ): Promise<string> {
    return this.request('POST', `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`, {
      snapname: name,
      description
    })
  }

  rollbackSnapshot(node: string, type: GuestType, vmid: number, name: string): Promise<string> {
    return this.request(
      'POST',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(name)}/rollback`,
      {}
    )
  }

  deleteSnapshot(node: string, type: GuestType, vmid: number, name: string): Promise<string> {
    return this.request(
      'DELETE',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(name)}`
    )
  }

  tasks(node: string, limit = 30): Promise<PveTask[]> {
    return this.request('GET', `/nodes/${encodeURIComponent(node)}/tasks?limit=${limit}`)
  }

  /** Best-effort guest IPv4 addresses (QEMU guest agent or LXC interfaces). */
  async guestAddresses(node: string, type: GuestType, vmid: number): Promise<string[]> {
    const out: string[] = []
    const usable = (ip: string): boolean =>
      !!ip && !ip.startsWith('127.') && !ip.startsWith('169.254.')
    if (type === 'qemu') {
      const r = await this.request<{
        result: {
          name: string
          'ip-addresses'?: { 'ip-address-type': string; 'ip-address': string }[]
        }[]
      }>('GET', `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`)
      for (const iface of r.result ?? []) {
        if (iface.name === 'lo') continue
        for (const a of iface['ip-addresses'] ?? [])
          if (a['ip-address-type'] === 'ipv4' && usable(a['ip-address'])) out.push(a['ip-address'])
      }
    } else {
      const r = await this.request<{ name: string; inet?: string }[]>(
        'GET',
        `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`
      )
      for (const iface of r ?? []) {
        if (iface.name === 'lo') continue
        const ip = (iface.inet ?? '').split('/')[0]
        if (usable(ip)) out.push(ip)
      }
    }
    return out
  }

  async nodeAddress(node: string): Promise<string | null> {
    try {
      const status = await this.request<{ type: string; name: string; ip?: string }[]>(
        'GET',
        '/cluster/status'
      )
      return status.find((x) => x.type === 'node' && x.name === node)?.ip ?? null
    } catch {
      return null
    }
  }

  consoleUrl(node: string, type?: GuestType, vmid?: number, name?: string): string {
    const base = this.base()
    if (!type || !vmid)
      return `${base}/?console=shell&xtermjs=1&vmid=0&node=${encodeURIComponent(node)}&cmd=`
    const consoleType = type === 'qemu' ? 'kvm' : 'lxc'
    return `${base}/?console=${consoleType}&novnc=1&vmid=${vmid}&vmname=${encodeURIComponent(name ?? '')}&node=${encodeURIComponent(node)}&resize=off&cmd=`
  }
}

export function proxmoxClient(server: ProxmoxServer): ProxmoxClient {
  return new ProxmoxClient(server)
}

export function forgetTicket(serverId: string): void {
  tickets.delete(serverId)
}
