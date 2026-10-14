import { Fragment, useCallback, useEffect, useState } from 'react'
import type { GuestAction, GuestType, PveSnapshot, PveTask } from '../../../shared/api'
import { newId } from '../../../shared/merge'
import type { Host, ProxmoxServer, PveResource } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useT, fmt } from '../i18n'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { confirmDialog, formatBytes, promptDialog, promptOne } from '../lib'

const S = {
  id: {
    nameRequired: 'Nama wajib diisi',
    urlInvalid: 'URL tidak valid',
    tokenIdFormat: 'Token ID harus berformat user@realm!namatoken',
    tokenSecretRequired: 'Token secret wajib diisi',
    userPassRequired: 'Username dan password wajib diisi',
    connected: 'Terhubung: Proxmox VE %s',
    editX: 'Edit %s',
    newServerTitle: 'Server Proxmox baru',
    testing: 'Mengetes…',
    testConn: 'Tes koneksi',
    cancel: 'Batal',
    save: 'Simpan',
    name: 'Nama',
    namePh: 'pve-rumah',
    portHint: 'Port 8006 dipakai bila tidak diisi.',
    loginWith: 'Login dengan',
    apiTokenOpt: 'API token (disarankan)',
    sshHostLabel: 'Host SSH untuk node (opsional)',
    sshHostHint: 'Kalau kosong, Termos SSH sebagai root ke IP node dari API.',
    auto: '(otomatis)',
    fpLabel: 'Fingerprint sertifikat (dipin)',
    forget: 'Lupakan',
    certSelfSigned: 'Sertifikat self-signed',
    unnamed: '(tanpa nama)',
    certVerify:
      '. Cocokkan fingerprint SHA-256 ini dengan Datacenter → node → System → Certificates:',
    trustRetest: 'Percayai & tes ulang',
    certChanged:
      'Fingerprint sertifikat BERUBAH (diharapkan %s, didapat %s). Jangan lanjut kecuali sertifikat memang diganti.',
    forceStop: 'Stop paksa',
    actConfirm: '%s %s %s (%s)?%s',
    stopWarning: ' Ini seperti mencabut listrik.',
    actionSent: '%s %s dikirim',
    saveAsHost: 'Simpan sebagai host SSH',
    sshTo: 'SSH ke %s',
    addrDetected: 'Alamat (terdeteksi: %s)',
    addrLabel: 'Alamat IP / hostname',
    connect: 'Hubungkan',
    hostSaved: 'Host "%s" disimpan',
    searchPh: 'Cari VM / CT, VMID, tag…',
    reload: 'Muat ulang',
    removeServer: 'Hapus server',
    removeServerConfirm: 'Hapus "%s" dari Termos?',
    remove: 'Hapus',
    certUntrustedTree: 'Sertifikat self-signed belum dipercaya. Fingerprint:',
    trustCert: 'Percayai sertifikat ini',
    certChangedTree:
      'Fingerprint sertifikat berubah! Diharapkan %s, didapat %s. Hapus pin di Edit server kalau memang diganti.',
    loading: 'Memuat…',
    webShell: 'Shell web',
    taskRunning: 'berjalan',
    noMatch: 'Tidak ada VM/CT yang cocok di node ini.',
    noGuests: 'Node ini belum punya VM atau CT.',
    type: 'Jenis',
    runningUp: 'jalan, up %s',
    processing: '(memproses)',
    enterViaNode: 'Masuk lewat node (pct enter)',
    serialViaNode: 'Serial console lewat node (qm terminal)',
    saveHost: 'Simpan host',
    newSnapshot: 'Snapshot baru',
    snapNameHint: 'Nama (huruf di awal; huruf, angka, _ atau -)',
    invalidSnapName: 'Nama snapshot tidak valid',
    snapshotCreated: 'Snapshot "%s" sedang dibuat',
    createSnapshot: 'Buat snapshot',
    noSnapshots: '%s ini belum punya snapshot. Buat satu sebelum mengubah konfigurasi.',
    rollbackConfirm: 'Kembalikan %s ke "%s"? Semua perubahan setelah snapshot ini hilang.',
    rollbackSent: 'Rollback dikirim',
    removeSnapshot: 'Hapus snapshot',
    removeSnapConfirm: 'Hapus "%s"?',
    snapshotRemoved: 'Snapshot dihapus',
    addServer: 'Server baru',
    emptyText:
      'Belum ada server Proxmox. Buat API token di Datacenter, Permissions, API Tokens, lalu tambahkan servernya di sini.',
    addProxmox: 'Tambah server Proxmox',
    upDays: '%sh %sj',
    upHours: '%sj %sm',
    upMin: '%sm'
  },
  en: {
    nameRequired: 'Name is required',
    urlInvalid: 'Invalid URL',
    tokenIdFormat: 'Token ID must be in the format user@realm!tokenname',
    tokenSecretRequired: 'Token secret is required',
    userPassRequired: 'Username and password are required',
    connected: 'Connected: Proxmox VE %s',
    editX: 'Edit %s',
    newServerTitle: 'New Proxmox server',
    testing: 'Testing…',
    testConn: 'Test connection',
    cancel: 'Cancel',
    save: 'Save',
    name: 'Name',
    namePh: 'pve-home',
    portHint: 'Port 8006 is used when not specified.',
    loginWith: 'Log in with',
    apiTokenOpt: 'API token (recommended)',
    sshHostLabel: 'SSH host for the node (optional)',
    sshHostHint: 'If empty, Termos SSHes as root to the node IP from the API.',
    auto: '(automatic)',
    fpLabel: 'Certificate fingerprint (pinned)',
    forget: 'Forget',
    certSelfSigned: 'Self-signed certificate',
    unnamed: '(unnamed)',
    certVerify:
      '. Match this SHA-256 fingerprint against Datacenter → node → System → Certificates:',
    trustRetest: 'Trust & retest',
    certChanged:
      'Certificate fingerprint CHANGED (expected %s, got %s). Do not continue unless the certificate was really replaced.',
    forceStop: 'Force stop',
    actConfirm: '%s %s %s (%s)?%s',
    stopWarning: " It's like pulling the power plug.",
    actionSent: '%s %s sent',
    saveAsHost: 'Save as SSH host',
    sshTo: 'SSH to %s',
    addrDetected: 'Address (detected: %s)',
    addrLabel: 'IP address / hostname',
    connect: 'Connect',
    hostSaved: 'Host "%s" saved',
    searchPh: 'Search VM / CT, VMID, tag…',
    reload: 'Reload',
    removeServer: 'Remove server',
    removeServerConfirm: 'Remove "%s" from Termos?',
    remove: 'Remove',
    certUntrustedTree: 'Self-signed certificate not yet trusted. Fingerprint:',
    trustCert: 'Trust this certificate',
    certChangedTree:
      'Certificate fingerprint changed! Expected %s, got %s. Remove the pin in Edit server if it was really replaced.',
    loading: 'Loading…',
    webShell: 'Web shell',
    taskRunning: 'running',
    noMatch: 'No matching VM/CT on this node.',
    noGuests: 'This node has no VMs or CTs yet.',
    type: 'Type',
    runningUp: 'running, up %s',
    processing: '(working)',
    enterViaNode: 'Enter via node (pct enter)',
    serialViaNode: 'Serial console via node (qm terminal)',
    saveHost: 'Save host',
    newSnapshot: 'New snapshot',
    snapNameHint: 'Name (starts with a letter; letters, digits, _ or -)',
    invalidSnapName: 'Invalid snapshot name',
    snapshotCreated: 'Snapshot "%s" created',
    createSnapshot: 'Create snapshot',
    noSnapshots: 'This %s has no snapshots yet. Create one before changing the configuration.',
    rollbackConfirm: 'Roll %s back to "%s"? All changes after this snapshot are lost.',
    rollbackSent: 'Rollback sent',
    removeSnapshot: 'Remove snapshot',
    removeSnapConfirm: 'Remove "%s"?',
    snapshotRemoved: 'Snapshot removed',
    addServer: 'New server',
    emptyText:
      'No Proxmox servers yet. Create an API token under Datacenter, Permissions, API Tokens, then add the server here.',
    addProxmox: 'Add Proxmox server',
    upDays: '%sd %sh',
    upHours: '%sh %sm',
    upMin: '%sm'
  }
}

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
  const t = useT(S)
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
    if (!s.label.trim()) return t.nameRequired
    try {
      normalizeUrl(s.url)
    } catch {
      return t.urlInvalid
    }
    if (s.authType === 'token') {
      if (!/^[^@\s]+@[^!\s]+![^\s]+$/.test(s.tokenId?.trim() ?? '')) return t.tokenIdFormat
      if (!s.tokenSecret) return t.tokenSecretRequired
    } else if (!s.username || !s.password) return t.userPassRequired
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
      setTest({ ok: true, text: fmt(t.connected, v.version) })
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
      title={server ? fmt(t.editX, server.label) : t.newServerTitle}
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={busy || !!error} onClick={() => void runTest()}>
            {busy ? t.testing : t.testConn}
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t.cancel}
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
            {t.save}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={t.name}>
          <input
            className="input"
            autoFocus
            value={s.label}
            onChange={(e) => setS({ ...s, label: e.target.value })}
            placeholder={t.namePh}
          />
        </Field>
        <Field label="URL" hint={t.portHint}>
          <input
            className="input"
            value={s.url}
            onChange={(e) => setS({ ...s, url: e.target.value, fingerprint: undefined })}
            placeholder="https://192.168.1.10:8006"
          />
        </Field>
      </div>
      <Field label={t.loginWith}>
        <select
          className="select"
          value={s.authType}
          onChange={(e) => setS({ ...s, authType: e.target.value as 'token' | 'password' })}
        >
          <option value="token">{t.apiTokenOpt}</option>
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
      <Field label={t.sshHostLabel} hint={t.sshHostHint}>
        <select
          className="select"
          value={s.sshHostId ?? ''}
          onChange={(e) => setS({ ...s, sshHostId: e.target.value || undefined })}
        >
          <option value="">{t.auto}</option>
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
        <Field label={t.fpLabel}>
          <div className="row">
            <span className="fp grow">{s.fingerprint}</span>
            <button className="btn sm" onClick={() => setS({ ...s, fingerprint: undefined })}>
              {t.forget}
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
                {t.certSelfSigned} <b>{cert.b || t.unnamed}</b>
                {t.certVerify}
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
                {t.trustRetest}
              </button>
            </>
          ) : (
            <>{fmt(t.certChanged, cert.a, cert.b)}</>
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
  const u = S[useStore.getState().lang]
  return d
    ? fmt(u.upDays, String(d), String(h))
    : h
      ? fmt(u.upHours, String(h), String(m))
      : fmt(u.upMin, String(m))
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
  const t = useT(S)
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
    const timer = setInterval(() => void load(), 10000)
    return () => clearInterval(timer)
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
      stop: t.forceStop,
      reboot: 'Reboot',
      shutdown: 'Shutdown'
    }
    if (labels[action]) {
      const ok = await confirmDialog(
        labels[action]!,
        fmt(
          t.actConfirm,
          labels[action]!,
          g.type === 'qemu' ? 'VM' : 'CT',
          String(g.vmid),
          g.name ?? '',
          action === 'stop' ? t.stopWarning : ''
        ),
        { danger: action === 'stop', okLabel: labels[action] }
      )
      if (!ok) return
    }
    setBusy((b) => new Set(b).add(g.id))
    try {
      await api.pveAction(server.id, g.node, g.type as GuestType, g.vmid!, action)
      toast(fmt(t.actionSent, action, String(g.vmid)))
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
      save ? t.saveAsHost : fmt(t.sshTo, String(g.name ?? g.vmid)),
      [
        {
          key: 'ip',
          label: ips.length > 1 ? fmt(t.addrDetected, ips.join(', ')) : t.addrLabel,
          value: ips[0] ?? ''
        },
        { key: 'user', label: 'Username', value: 'root' }
      ],
      save ? t.save : t.connect
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
      toast(fmt(t.hostSaved, label))
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
          placeholder={t.searchPh}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="grow" />
        <button className="btn sm" onClick={() => void load()}>
          {t.reload}
        </button>
        <button className="btn sm" onClick={() => setEditing(true)}>
          Edit server
        </button>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (
              await confirmDialog(t.removeServer, fmt(t.removeServerConfirm, server.label), {
                danger: true,
                okLabel: t.remove
              })
            )
              await api.remove('proxmox', server.id)
          }}
        >
          {t.remove}
        </button>
      </div>

      {cert && (
        <div className="alert warn small">
          {cert.kind === 'untrusted' ? (
            <>
              {t.certUntrustedTree} <span className="fp">{cert.a}</span>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api.upsert('proxmox', { ...server, fingerprint: cert.a })
                    setTimeout(() => void load(), 300)
                  }}
                >
                  {t.trustCert}
                </button>
              </div>
            </>
          ) : (
            <>{fmt(t.certChangedTree, cert.a, cert.b)}</>
          )}
        </div>
      )}
      {error && !cert && <div className="alert error small">{error}</div>}
      {!res && !error && <div className="dim">{t.loading}</div>}

      {nodes.map((n) => {
        const open = !collapsed.has(n.node)
        const guests = guestsOf(n.node)
        return (
          <section key={n.id} className="pve-node" aria-label={`Node ${n.node}`}>
            <div className="pve-node-head">
              <button
                className="pve-toggle"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((c) => {
                    const x = new Set(c)
                    if (x.has(n.node)) x.delete(n.node)
                    else x.add(n.node)
                    return x
                  })
                }
              >
                <span aria-hidden>{open ? '▾' : '▸'}</span>
                <span className={'dot ' + n.status} aria-label={n.status} />
                {n.node}
              </button>
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
              <span className="muted small">up {uptime(n.uptime)}</span>
              <span className="grow" />
              <button
                className="btn sm"
                onClick={() =>
                  void openSession({ kind: 'proxmox', serverId: server.id, node: n.node })
                }
              >
                SSH
              </button>
              <button className="btn sm" onClick={() => void api.pveOpenConsole(server.id, n.node)}>
                {t.webShell}
              </button>
              <button
                className={'btn sm' + (tasks?.node === n.node ? ' on' : '')}
                aria-pressed={tasks?.node === n.node}
                onClick={async () => {
                  if (tasks?.node === n.node) return setTasks(null)
                  try {
                    setTasks({ node: n.node, list: await api.pveTasks(server.id, n.node) })
                  } catch (e) {
                    toast(errMsg(e), 'error')
                  }
                }}
              >
                Task log
              </button>
            </div>
            {tasks?.node === n.node && (
              <div className="pve-sub">
                <table className="simple">
                  <tbody>
                    {tasks.list.map((task) => (
                      <tr key={task.upid}>
                        <td className="muted">
                          {new Date(task.starttime * 1000).toLocaleString()}
                        </td>
                        <td>{task.type}</td>
                        <td>{task.id}</td>
                        <td className="muted">{task.user}</td>
                        <td
                          style={{
                            color: task.status && task.status !== 'OK' ? 'var(--danger)' : undefined
                          }}
                        >
                          {task.status ?? t.taskRunning}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open && guests.length === 0 && (
              <div className="muted small" style={{ padding: '8px 12px' }}>
                {q ? t.noMatch : t.noGuests}
              </div>
            )}
            {open && guests.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t.name}</th>
                    <th>{t.type}</th>
                    <th>Status</th>
                    <th>CPU</th>
                    <th>RAM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {guests.map((g) => {
                    const running = g.status === 'running'
                    const isBusy = busy.has(g.id)
                    const kind = g.type === 'qemu' ? 'VM' : 'CT'
                    return (
                      <Fragment key={g.id}>
                        <tr className={g.template ? 'template' : ''}>
                          <td className="mono">{g.vmid}</td>
                          <td>
                            <span className="cell-title">{g.name || t.unnamed}</span>
                            {g.tags &&
                              g.tags
                                .split(/[;,\s]+/)
                                .filter(Boolean)
                                .map((tag) => (
                                  <span key={tag} className="tag" style={{ marginLeft: 6 }}>
                                    {tag}
                                  </span>
                                ))}
                          </td>
                          <td className="muted">{g.template ? `${kind} template` : kind}</td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <span className={'dot ' + g.status} />
                              {running ? fmt(t.runningUp, uptime(g.uptime)) : g.status}
                              {isBusy && <span className="muted">{t.processing}</span>}
                            </span>
                          </td>
                          <td>
                            {running ? (
                              <Stat label="" used={g.cpu} max={1} text={`${pct(g.cpu, 1)}%`} />
                            ) : (
                              ''
                            )}
                          </td>
                          <td>
                            {running ? (
                              <Stat
                                label=""
                                used={g.mem}
                                max={g.maxmem}
                                text={formatBytes(g.mem)}
                              />
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="actions">
                            {!g.template && (
                              <>
                                {g.status === 'stopped' && (
                                  <button
                                    className="btn sm"
                                    disabled={isBusy}
                                    onClick={() => act(g, 'start')}
                                  >
                                    Start
                                  </button>
                                )}
                                {g.status === 'paused' && (
                                  <button
                                    className="btn sm"
                                    disabled={isBusy}
                                    onClick={() => act(g, 'resume')}
                                  >
                                    Resume
                                  </button>
                                )}
                                {running && (
                                  <>
                                    <button className="btn sm" onClick={() => void sshGuest(g)}>
                                      SSH
                                    </button>
                                    <button
                                      className="btn sm"
                                      title={g.type === 'lxc' ? t.enterViaNode : t.serialViaNode}
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
                                      {g.type === 'lxc' ? 'pct enter' : 'Serial'}
                                    </button>
                                    <button
                                      className="btn sm"
                                      disabled={isBusy}
                                      onClick={() => act(g, 'shutdown')}
                                    >
                                      Shutdown
                                    </button>
                                    <button
                                      className="btn sm"
                                      disabled={isBusy}
                                      onClick={() => act(g, 'reboot')}
                                    >
                                      Reboot
                                    </button>
                                    {g.type === 'qemu' && (
                                      <button
                                        className="btn sm"
                                        disabled={isBusy}
                                        onClick={() => act(g, 'suspend')}
                                      >
                                        Suspend
                                      </button>
                                    )}
                                  </>
                                )}
                                <button
                                  className="btn sm"
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
                                  Console
                                </button>
                              </>
                            )}
                            <button
                              className={'btn sm' + (snaps?.g.id === g.id ? ' on' : '')}
                              aria-pressed={snaps?.g.id === g.id}
                              onClick={() =>
                                snaps?.g.id === g.id ? setSnaps(null) : void loadSnaps(g)
                              }
                            >
                              Snapshot
                            </button>
                            <button className="btn sm ghost" onClick={() => void sshGuest(g, true)}>
                              {t.saveHost}
                            </button>
                            {running && !g.template && (
                              <button
                                className="btn sm ghost danger"
                                disabled={isBusy}
                                onClick={() => act(g, 'stop')}
                              >
                                {t.forceStop}
                              </button>
                            )}
                          </td>
                        </tr>
                        {snaps?.g.id === g.id && (
                          <tr>
                            <td colSpan={7} className="pve-sub">
                              <div className="row" style={{ marginBottom: 8 }}>
                                <span className="cell-title grow">Snapshot {g.name}</span>
                                <button
                                  className="btn sm"
                                  onClick={async () => {
                                    const name = await promptOne(
                                      t.newSnapshot,
                                      t.snapNameHint,
                                      `termos_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
                                    )
                                    if (!name) return
                                    if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(name))
                                      return toast(t.invalidSnapName, 'error')
                                    try {
                                      await api.pveSnapshotCreate(
                                        server.id,
                                        g.node,
                                        g.type as GuestType,
                                        g.vmid!,
                                        name
                                      )
                                      toast(fmt(t.snapshotCreated, name))
                                      setTimeout(() => void loadSnaps(g), 3000)
                                    } catch (e) {
                                      toast(errMsg(e), 'error')
                                    }
                                  }}
                                >
                                  {t.createSnapshot}
                                </button>
                              </div>
                              {snaps.list.length === 0 ? (
                                <div className="muted small">{fmt(t.noSnapshots, kind)}</div>
                              ) : (
                                <table className="simple">
                                  <tbody>
                                    {snaps.list.map((sn) => (
                                      <tr key={sn.name}>
                                        <td className="mono">{sn.name}</td>
                                        <td className="muted">{sn.description}</td>
                                        <td className="muted">
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
                                                toast(t.rollbackSent)
                                                setTimeout(() => void load(), 3000)
                                              } catch (e) {
                                                toast(errMsg(e), 'error')
                                              }
                                            }}
                                          >
                                            Rollback
                                          </button>{' '}
                                          <button
                                            className="btn sm ghost danger"
                                            onClick={async () => {
                                              if (
                                                !(await confirmDialog(
                                                  t.removeSnapshot,
                                                  fmt(t.removeSnapConfirm, sn.name),
                                                  {
                                                    danger: true,
                                                    okLabel: t.remove
                                                  }
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
                                                toast(t.snapshotRemoved)
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
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
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
              className={'btn sm' + (s.id === server?.id ? ' on' : '')}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          Server baru
        </button>
      </div>
      {server ? (
        <ServerTree key={server.id} server={server} />
      ) : (
        <div className="empty">
          <p>
            Belum ada server Proxmox. Buat API token di Datacenter, Permissions, API Tokens, lalu
            tambahkan servernya di sini.
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Tambah server Proxmox
          </button>
        </div>
      )}
      {adding && <ServerEditor onClose={() => setAdding(false)} />}
    </div>
  )
}
