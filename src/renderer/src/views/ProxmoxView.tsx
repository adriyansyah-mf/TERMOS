import { useCallback, useEffect, useState } from 'react'
import type { GuestAction, GuestType, PveSnapshot, PveTask } from '../../../shared/api'
import { newId } from '../../../shared/merge'
import type { Host, ProxmoxServer, PveResource } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { confirmDialog, formatBytes, promptDialog, promptOne } from '../lib'

interface CertProblem {
  kind: 'untrusted' | 'changed'
  a: string
  b: string
}

function parseCert(msg: string): CertProblem | null {
  const [tag, a, b] = msg.split('|')
  if (tag === 'UNTRUSTED_CERT') return { kind: 'untrusted', a, b }
  if (tag === 'CERT_CHANGED') return { kind: 'changed', a, b }
  return null
}

function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(u)) u = 'https://' + u
  const parsed = new URL(u)
  if (!parsed.port) parsed.port = '8006'
  return parsed.toString().replace(/\/+$/, '')
}

function ServerEditor({
  server,
  onClose
}: {
  server?: ProxmoxServer
  onClose(): void
}): React.JSX.Element {
  const hosts = useStore((s) => s.data?.hosts ?? [])
  const toast = useStore((s) => s.toast)
  const [s, setS] = useState<ProxmoxServer>(
    server ?? {
      id: newId(),
      updatedAt: 0,
      label: '',
      url: 'https://',
      authType: 'token',
      tokenId: 'root@pam!termos',
      realm: 'pam'
    }
  )
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [cert, setCert] = useState<CertProblem | null>(null)
  const [busy, setBusy] = useState(false)

  const error = (() => {
    if (!s.label.trim()) return 'Nama wajib diisi'
    try {
      normalizeUrl(s.url)
    } catch {
      return 'URL tidak valid'
    }
    if (s.authType === 'token') {
      if (!/^[^@\s]+@[^!\s]+![^\s]+$/.test(s.tokenId?.trim() ?? ''))
        return 'Token ID harus berformat user@realm!namatoken'
      if (!s.tokenSecret) return 'Token secret wajib diisi'
    } else if (!s.username || !s.password) return 'Username dan password wajib diisi'
    return null
  })()

  const clean = (x: ProxmoxServer): ProxmoxServer => ({
    ...x,
    label: x.label.trim(),
    url: normalizeUrl(x.url),
    tokenId: x.tokenId?.trim()
  })

  const runTest = async (draft = s): Promise<void> => {
    setBusy(true)
    setTest(null)
    setCert(null)
    try {
      const v = await api.pveVersion(clean(draft))
      setTest({ ok: true, text: `Terhubung — Proxmox VE ${v.version}` })
    } catch (e) {
      const c = parseCert(errMsg(e))
      if (c) setCert(c)
      else setTest({ ok: false, text: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      wide
      title={server ? `Edit ${server.label}` : 'Server Proxmox baru'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={busy || !!error} onClick={() => void runTest()}>
            {busy ? 'Mengetes…' : 'Tes koneksi'}
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!!error}
            onClick={async () => {
              try {
                await api.upsert('proxmox', clean(s))
                onClose()
              } catch (e) {
                toast(errMsg(e), 'error')
              }
            }}
          >
            Simpan
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Nama">
          <input
            className="input"
            autoFocus
            value={s.label}
            onChange={(e) => setS({ ...s, label: e.target.value })}
            placeholder="pve-rumah"
          />
        </Field>
        <Field label="URL" hint="Port 8006 dipakai bila tidak diisi.">
          <input
            className="input"
            value={s.url}
            onChange={(e) => setS({ ...s, url: e.target.value, fingerprint: undefined })}
            placeholder="https://192.168.1.10:8006"
          />
        </Field>
      </div>
      <Field label="Login dengan">
        <select
          className="select"
          value={s.authType}
          onChange={(e) => setS({ ...s, authType: e.target.value as 'token' | 'password' })}
        >
          <option value="token">API token (disarankan)</option>
          <option value="password">Username + password</option>
        </select>
      </Field>
      {s.authType === 'token' ? (
        <div className="grid-2">
          <Field label="Token ID" hint="Datacenter → Permissions → API Tokens">
            <input
              className="input mono"
              value={s.tokenId ?? ''}
              onChange={(e) => setS({ ...s, tokenId: e.target.value })}
            />
          </Field>
          <Field label="Token secret">
            <input
              className="input mono"
              type="password"
              value={s.tokenSecret ?? ''}
              onChange={(e) => setS({ ...s, tokenSecret: e.target.value })}
              placeholder="xxxxxxxx-xxxx-…"
            />
          </Field>
        </div>
      ) : (
        <div className="grid-3">
          <Field label="Username">
            <input
              className="input"
              value={s.username ?? ''}
              onChange={(e) => setS({ ...s, username: e.target.value })}
              placeholder="root"
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={s.password ?? ''}
              onChange={(e) => setS({ ...s, password: e.target.value })}
            />
          </Field>
          <Field label="Realm">
            <select
              className="select"
              value={s.realm ?? 'pam'}
              onChange={(e) => setS({ ...s, realm: e.target.value })}
            >
              <option value="pam">pam</option>
              <option value="pve">pve</option>
            </select>
          </Field>
        </div>
      )}
      <Field
        label="Host SSH untuk node (opsional)"
        hint="Kalau kosong, Termos SSH sebagai root ke IP node dari API."
      >
        <select
          className="select"
          value={s.sshHostId ?? ''}
          onChange={(e) => setS({ ...s, sshHostId: e.target.value || undefined })}
        >
          <option value="">— otomatis —</option>
          {hosts
            .filter((h) => h.protocol === 'ssh')
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
        </select>
      </Field>
      {s.fingerprint && (
        <Field label="Fingerprint sertifikat (dipin)">
          <div className="row">
            <span className="fp grow">{s.fingerprint}</span>
            <button className="btn sm" onClick={() => setS({ ...s, fingerprint: undefined })}>
              Lupakan
            </button>
          </div>
        </Field>
      )}
      {error && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {test && <div className={'alert small ' + (test.ok ? 'info' : 'error')}>{test.text}</div>}
      {cert && (
        <div className={'alert small ' + (cert.kind === 'changed' ? 'error' : 'warn')}>
          {cert.kind === 'untrusted' ? (
            <>
              <div>
                Sertifikat self-signed <b>{cert.b || '(tanpa nama)'}</b>. Cocokkan fingerprint
                SHA-256 ini dengan Datacenter → node → System → Certificates:
              </div>
              <div className="fp" style={{ margin: '6px 0' }}>
                {cert.a}
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  const next = { ...s, fingerprint: cert.a }
                  setS(next)
                  void runTest(next)
                }}
              >
                Percayai & tes ulang
              </button>
            </>
          ) : (
            <>
              Fingerprint sertifikat BERUBAH (diharapkan {cert.a}, didapat {cert.b}). Jangan lanjut
              kecuali sertifikat memang diganti.
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

const pct = (used?: number, max?: number): number =>
  used && max ? Math.min(100, Math.round((used / max) * 100)) : 0

function uptime(s?: number): string {
  if (!s) return '-'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}h ${h}j` : h ? `${h}j ${m}m` : `${m}m`
}

function Stat({
  label,
  used,
  max,
  text
}: {
  label: string
  used?: number
  max?: number
  text: string
}): React.JSX.Element {
  return (
    <span className="pve-stat">
      {label}
      <div className="bar">
        <div style={{ width: `${pct(used, max)}%` }} />
      </div>
      {text}
    </span>
  )
}

function ServerTree({ server }: { server: ProxmoxServer }): React.JSX.Element {
  const { toast, openSession } = useStore.getState()
  const [res, setRes] = useState<PveResource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [snaps, setSnaps] = useState<{ g: PveResource; list: PveSnapshot[] } | null>(null)
  const [tasks, setTasks] = useState<{ node: string; list: PveTask[] } | null>(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRes(await api.pveResources(server.id))
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [server.id])

  useEffect(() => {
    setRes(null)
    void load()
    const t = setInterval(() => void load(), 10000)
    return () => clearInterval(t)
  }, [load])

  const cert = error ? parseCert(error) : null
  const nodes = (res ?? [])
    .filter((r) => r.type === 'node')
    .sort((a, b) => a.node.localeCompare(b.node))
  const q = filter.trim().toLowerCase()
  const guestsOf = (node: string): PveResource[] =>
    (res ?? [])
      .filter((r) => (r.type === 'qemu' || r.type === 'lxc') && r.node === node)
      .filter(
        (g) =>
          !q ||
          String(g.vmid).includes(q) ||
          (g.name ?? '').toLowerCase().includes(q) ||
          (g.tags ?? '').includes(q)
      )
      .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0))

  const act = async (g: PveResource, action: GuestAction): Promise<void> => {
    const labels: Partial<Record<GuestAction, string>> = {
      stop: 'Stop paksa',
      reboot: 'Reboot',
      shutdown: 'Shutdown'
    }
    if (labels[action]) {
      const ok = await confirmDialog(
        labels[action]!,
        `${labels[action]} ${g.type === 'qemu' ? 'VM' : 'CT'} ${g.vmid} (${g.name ?? ''})?${action === 'stop' ? ' Ini seperti mencabut listrik.' : ''}`,
        { danger: action === 'stop', okLabel: labels[action] }
      )
      if (!ok) return
    }
    setBusy((b) => new Set(b).add(g.id))
    try {
      await api.pveAction(server.id, g.node, g.type as GuestType, g.vmid!, action)
      toast(`${action} ${g.vmid} dikirim`)
      setTimeout(() => void load(), 2500)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(g.id)
        return n
      })
    }
  }

  const loadSnaps = async (g: PveResource): Promise<void> => {
    try {
      const list = await api.pveSnapshots(server.id, g.node, g.type as GuestType, g.vmid!)
      setSnaps({ g, list: list.sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0)) })
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const sshGuest = async (g: PveResource, save = false): Promise<void> => {
    let ips: string[] = []
    try {
      ips = await api.pveGuestAddresses(server.id, g.node, g.type as GuestType, g.vmid!)
    } catch {
      /* guest agent not running; ask manually */
    }
    const r = await promptDialog(
      save ? 'Simpan sebagai host SSH' : `SSH ke ${g.name ?? g.vmid}`,
      [
        {
          key: 'ip',
          label: ips.length > 1 ? `Alamat (terdeteksi: ${ips.join(', ')})` : 'Alamat IP / hostname',
          value: ips[0] ?? ''
        },
        { key: 'user', label: 'Username', value: 'root' }
      ],
      save ? 'Simpan' : 'Hubungkan'
    )
    if (!r?.ip) return
    const label = `${g.name ?? g.vmid} (${g.vmid})`
    if (save) {
      const groupLabel = `Proxmox / ${server.label}`
      const data = useStore.getState().data!
      let group = data.groups.find((x) => x.label === groupLabel)
      if (!group)
        group = await api.upsert('groups', {
          id: newId(),
          updatedAt: 0,
          label: groupLabel,
          config: {}
        })
      await api.upsert<Host>('hosts', {
        id: newId(),
        updatedAt: 0,
        label,
        address: r.ip,
        protocol: 'ssh',
        groupId: group.id,
        tags: g.tags ? g.tags.split(/[;,\s]+/).filter(Boolean) : [],
        source: { kind: 'proxmox', ref: `${server.id}/${g.vmid}` },
        config: { username: r.user || 'root' }
      })
      toast(`Host "${label}" disimpan`)
    } else {
      void openSession({
        kind: 'adhoc',
        host: { label, address: r.ip, protocol: 'ssh', config: { username: r.user || 'root' } }
      })
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="input search"
          placeholder="Cari VM / CT, VMID, tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="grow" />
        <button className="btn sm" onClick={() => void load()}>
          ⟳ Refresh
        </button>
        <button className="btn sm" onClick={() => setEditing(true)}>
          Edit server
        </button>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (
              await confirmDialog('Hapus server', `Hapus "${server.label}" dari Termos?`, {
                danger: true,
                okLabel: 'Hapus'
              })
            )
              await api.remove('proxmox', server.id)
          }}
        >
          Hapus
        </button>
      </div>

      {cert && (
        <div className="alert warn small">
          {cert.kind === 'untrusted' ? (
            <>
              Sertifikat self-signed belum dipercaya. Fingerprint:{' '}
              <span className="fp">{cert.a}</span>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api.upsert('proxmox', { ...server, fingerprint: cert.a })
                    setTimeout(() => void load(), 300)
                  }}
                >
                  Percayai sertifikat ini
                </button>
              </div>
            </>
          ) : (
            <>
              Fingerprint sertifikat berubah! Diharapkan {cert.a}, didapat {cert.b}. Hapus pin di
              Edit server kalau memang diganti.
            </>
          )}
        </div>
      )}
      {error && !cert && <div className="alert error small">{error}</div>}
      {!res && !error && <div className="dim">Memuat…</div>}

      {nodes.map((n) => {
        const open = !collapsed.has(n.node)
        return (
          <div key={n.id} className="pve-node">
            <div
              className="pve-node-head"
              onClick={() =>
                setCollapsed((c) => {
                  const x = new Set(c)
                  if (x.has(n.node)) x.delete(n.node)
                  else x.add(n.node)
                  return x
                })
              }
            >
              <span>{open ? '▾' : '▸'}</span>
              <span className={'dot ' + n.status} />
              <strong>{n.node}</strong>
              <Stat label="CPU" used={n.cpu} max={1} text={`${pct(n.cpu, 1)}%`} />
              <Stat
                label="RAM"
                used={n.mem}
                max={n.maxmem}
                text={`${formatBytes(n.mem)} / ${formatBytes(n.maxmem)}`}
              />
              <Stat
                label="Disk"
                used={n.disk}
                max={n.maxdisk}
                text={`${pct(n.disk, n.maxdisk)}%`}
              />
              <span className="dim small">up {uptime(n.uptime)}</span>
              <span className="grow" />
              <span className="row" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn sm"
                  onClick={() =>
                    void openSession({ kind: 'proxmox', serverId: server.id, node: n.node })
                  }
                >
                  ›_ SSH
                </button>
                <button
                  className="btn sm"
                  title="Shell web Proxmox"
                  onClick={() => void api.pveOpenConsole(server.id, n.node)}
                >
                  🌐
                </button>
                <button
                  className="btn sm"
                  title="Task log"
                  onClick={async () => {
                    if (tasks?.node === n.node) return setTasks(null)
                    try {
                      setTasks({ node: n.node, list: await api.pveTasks(server.id, n.node) })
                    } catch (e) {
                      toast(errMsg(e), 'error')
                    }
                  }}
                >
                  ☰
                </button>
              </span>
            </div>
            {tasks?.node === n.node && (
              <div className="pve-sub">
                <table className="simple">
                  <tbody>
                    {tasks.list.map((t) => (
                      <tr key={t.upid}>
                        <td className="dim">{new Date(t.starttime * 1000).toLocaleString()}</td>
                        <td>{t.type}</td>
                        <td>{t.id}</td>
                        <td className="dim">{t.user}</td>
                        <td
                          style={{
                            color: t.status && t.status !== 'OK' ? 'var(--danger)' : undefined
                          }}
                        >
                          {t.status ?? 'berjalan…'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open &&
              guestsOf(n.node).map((g) => {
                const running = g.status === 'running'
                const isBusy = busy.has(g.id)
                return (
                  <div key={g.id}>
                    <div className={'pve-guest' + (g.template ? ' template' : '')}>
                      <span className={'dot ' + g.status} />
                      <span className={'tag ' + (g.type === 'qemu' ? 'vm' : 'ct')}>
                        {g.type === 'qemu' ? 'VM' : 'CT'}
                      </span>
                      <span className="mono dim">{g.vmid}</span>
                      <div className="ellipsis" style={{ minWidth: 120 }}>
                        <div>{g.name || '(tanpa nama)'}</div>
                        {g.tags && (
                          <div className="row" style={{ gap: 4 }}>
                            {g.tags
                              .split(/[;,\s]+/)
                              .filter(Boolean)
                              .map((t) => (
                                <span key={t} className="tag">
                                  {t}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                      {running ? (
                        <>
                          <Stat label="CPU" used={g.cpu} max={1} text={`${pct(g.cpu, 1)}%`} />
                          <Stat label="RAM" used={g.mem} max={g.maxmem} text={formatBytes(g.mem)} />
                          <span className="dim small">up {uptime(g.uptime)}</span>
                        </>
                      ) : (
                        <span className="dim small">{g.status}</span>
                      )}
                      <span className="grow" />
                      {g.template ? (
                        <span className="dim small">Template</span>
                      ) : (
                        <span className="row" style={{ gap: 4 }}>
                          {isBusy && <span className="dim">…</span>}
                          {g.status === 'stopped' && (
                            <button
                              className="btn sm ok"
                              disabled={isBusy}
                              onClick={() => act(g, 'start')}
                              title="Start"
                            >
                              ▶
                            </button>
                          )}
                          {g.status === 'paused' && (
                            <button
                              className="btn sm ok"
                              disabled={isBusy}
                              onClick={() => act(g, 'resume')}
                              title="Resume"
                            >
                              ▶
                            </button>
                          )}
                          {running && (
                            <>
                              <button
                                className="btn sm"
                                onClick={() => void sshGuest(g)}
                                title="SSH ke IP guest"
                              >
                                ›_ SSH
                              </button>
                              <button
                                className="btn sm"
                                title={
                                  g.type === 'lxc'
                                    ? 'Masuk lewat node (pct enter)'
                                    : 'Serial console lewat node (qm terminal)'
                                }
                                onClick={() =>
                                  void openSession({
                                    kind: 'proxmox',
                                    serverId: server.id,
                                    node: g.node,
                                    vmType: g.type as GuestType,
                                    vmid: g.vmid
                                  })
                                }
                              >
                                {g.type === 'lxc' ? 'pct' : 'serial'}
                              </button>
                              <button
                                className="btn sm"
                                disabled={isBusy}
                                onClick={() => act(g, 'shutdown')}
                                title="Shutdown"
                              >
                                ⏻
                              </button>
                              <button
                                className="btn sm"
                                disabled={isBusy}
                                onClick={() => act(g, 'reboot')}
                                title="Reboot"
                              >
                                ↻
                              </button>
                              {g.type === 'qemu' && (
                                <button
                                  className="btn sm"
                                  disabled={isBusy}
                                  onClick={() => act(g, 'suspend')}
                                  title="Suspend"
                                >
                                  ⏸
                                </button>
                              )}
                              <button
                                className="btn sm danger"
                                disabled={isBusy}
                                onClick={() => act(g, 'stop')}
                                title="Stop paksa"
                              >
                                ■
                              </button>
                            </>
                          )}
                          <button
                            className="btn sm"
                            title="Console web (noVNC)"
                            onClick={() =>
                              void api.pveOpenConsole(
                                server.id,
                                g.node,
                                g.type as GuestType,
                                g.vmid,
                                g.name
                              )
                            }
                          >
                            🖥
                          </button>
                          <button
                            className={'btn sm' + (snaps?.g.id === g.id ? ' primary' : '')}
                            title="Snapshot"
                            onClick={() =>
                              snaps?.g.id === g.id ? setSnaps(null) : void loadSnaps(g)
                            }
                          >
                            📷
                          </button>
                          <button
                            className="btn sm"
                            title="Simpan sebagai host SSH"
                            onClick={() => void sshGuest(g, true)}
                          >
                            ＋
                          </button>
                        </span>
                      )}
                    </div>
                    {snaps?.g.id === g.id && (
                      <div className="pve-sub">
                        <div className="row" style={{ marginBottom: 8 }}>
                          <strong className="grow">Snapshot {g.name}</strong>
                          <button
                            className="btn sm primary"
                            onClick={async () => {
                              const name = await promptOne(
                                'Snapshot baru',
                                'Nama (huruf di awal; huruf, angka, _ atau -)',
                                `termos_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
                              )
                              if (!name) return
                              if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(name))
                                return toast('Nama snapshot tidak valid', 'error')
                              try {
                                await api.pveSnapshotCreate(
                                  server.id,
                                  g.node,
                                  g.type as GuestType,
                                  g.vmid!,
                                  name
                                )
                                toast(`Snapshot "${name}" sedang dibuat`)
                                setTimeout(() => void loadSnaps(g), 3000)
                              } catch (e) {
                                toast(errMsg(e), 'error')
                              }
                            }}
                          >
                            + Snapshot
                          </button>
                        </div>
                        {snaps.list.length === 0 ? (
                          <div className="dim small">Belum ada snapshot.</div>
                        ) : (
                          <table className="simple">
                            <tbody>
                              {snaps.list.map((sn) => (
                                <tr key={sn.name}>
                                  <td>📷 {sn.name}</td>
                                  <td className="dim">{sn.description}</td>
                                  <td className="dim">
                                    {sn.snaptime
                                      ? new Date(sn.snaptime * 1000).toLocaleString()
                                      : ''}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      className="btn sm"
                                      onClick={async () => {
                                        const ok = await confirmDialog(
                                          'Rollback',
                                          `Kembalikan ${g.name ?? g.vmid} ke "${sn.name}"? Semua perubahan setelah snapshot ini hilang.`,
                                          { danger: true, okLabel: 'Rollback' }
                                        )
                                        if (!ok) return
                                        try {
                                          await api.pveSnapshotRollback(
                                            server.id,
                                            g.node,
                                            g.type as GuestType,
                                            g.vmid!,
                                            sn.name
                                          )
                                          toast('Rollback dikirim')
                                          setTimeout(() => void load(), 3000)
                                        } catch (e) {
                                          toast(errMsg(e), 'error')
                                        }
                                      }}
                                    >
                                      Rollback
                                    </button>{' '}
                                    <button
                                      className="btn sm danger"
                                      onClick={async () => {
                                        if (
                                          !(await confirmDialog(
                                            'Hapus snapshot',
                                            `Hapus "${sn.name}"?`,
                                            { danger: true, okLabel: 'Hapus' }
                                          ))
                                        )
                                          return
                                        try {
                                          await api.pveSnapshotDelete(
                                            server.id,
                                            g.node,
                                            g.type as GuestType,
                                            g.vmid!,
                                            sn.name
                                          )
                                          toast('Snapshot dihapus')
                                          setTimeout(() => void loadSnaps(g), 2000)
                                        } catch (e) {
                                          toast(errMsg(e), 'error')
                                        }
                                      }}
                                    >
                                      Hapus
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )
      })}
      {editing && <ServerEditor server={server} onClose={() => setEditing(false)} />}
    </div>
  )
}

export function ProxmoxView(): React.JSX.Element {
  const servers = useStore((s) => s.data?.proxmox ?? [])
  const [active, setActive] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const server = servers.find((s) => s.id === active) ?? servers[0]

  return (
    <div className="view">
      <div className="view-head">
        <h1>Proxmox</h1>
        {servers.length > 1 &&
          servers.map((s) => (
            <button
              key={s.id}
              className={'btn sm' + (s.id === server?.id ? ' primary' : '')}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Server
        </button>
      </div>
      {server ? (
        <ServerTree key={server.id} server={server} />
      ) : (
        <div className="empty">
          <div className="big">🗄️</div>
          <div style={{ marginBottom: 14 }}>
            Belum ada server Proxmox. Tambahkan dengan API token (Datacenter → Permissions → API
            Tokens).
          </div>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Tambah server
          </button>
        </div>
      )}
      {adding && <ServerEditor onClose={() => setAdding(false)} />}
    </div>
  )
}
