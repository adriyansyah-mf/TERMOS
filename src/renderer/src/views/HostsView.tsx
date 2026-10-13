import { useMemo, useState } from 'react'
import type { Group, Host } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { confirmDialog, timeAgo } from '../lib'
import { HostPicker } from '../components/HostPicker'
import { GroupEditor, HostEditor } from './HostEditor'

type SortKey = 'label' | 'address' | 'lastConnectedAt'

function addressOf(h: Host): string {
  if (h.protocol === 'local') return 'terminal lokal'
  if (h.protocol === 'serial')
    return `${h.serial?.path ?? h.address} @ ${h.serial?.baudRate ?? 9600}`
  const port = h.config.port ? `:${h.config.port}` : ''
  return `${h.config.username ? h.config.username + '@' : ''}${h.address}${port}`
}

export function HostsView(): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const { openSession, toast } = useStore.getState()
  const [q, setQ] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'label', desc: false })
  const [editing, setEditing] = useState<{ host?: Host } | null>(null)
  const [editingGroup, setEditingGroup] = useState<{ group?: Group } | null>(null)
  const [quick, setQuick] = useState(false)

  const group = data.groups.find((g) => g.id === groupId)
  const needle = q.trim().toLowerCase()
  const subGroups = needle ? [] : data.groups.filter((g) => (g.parentId ?? null) === groupId)
  const hosts = useMemo(() => {
    const list = data.hosts.filter((h) =>
      needle
        ? h.label.toLowerCase().includes(needle) ||
          h.address.toLowerCase().includes(needle) ||
          h.tags.some((t) => t.toLowerCase().includes(needle))
        : (h.groupId ?? null) === groupId
    )
    const dir = sort.desc ? -1 : 1
    return list.sort((a, b) => {
      if (sort.key === 'lastConnectedAt')
        return ((a.lastConnectedAt ?? 0) - (b.lastConnectedAt ?? 0)) * dir
      return addressOrLabel(a, sort.key).localeCompare(addressOrLabel(b, sort.key)) * dir
    })
  }, [data.hosts, needle, groupId, sort])

  const connect = (h: Host): void => void openSession({ kind: 'host', hostId: h.id })

  const removeHost = async (h: Host): Promise<void> => {
    if (
      await confirmDialog('Hapus host', `Hapus "${h.label}"?`, { danger: true, okLabel: 'Hapus' })
    )
      await api.remove('hosts', h.id)
  }

  const removeGroup = async (g: Group): Promise<void> => {
    const count = data.hosts.filter((h) => h.groupId === g.id).length
    const ok = await confirmDialog(
      'Hapus grup',
      `Hapus grup "${g.label}"? ${count} host di dalamnya dipindah keluar grup.`,
      { danger: true, okLabel: 'Hapus' }
    )
    if (!ok) return
    for (const h of data.hosts.filter((x) => x.groupId === g.id))
      await api.upsert<Host>('hosts', { ...h, groupId: g.parentId })
    for (const c of data.groups.filter((x) => x.parentId === g.id))
      await api.upsert<Group>('groups', { ...c, parentId: g.parentId })
    await api.remove('groups', g.id)
    setGroupId(g.parentId ?? null)
  }

  const importConfig = async (): Promise<void> => {
    try {
      const r = await api.importSshConfig()
      toast(`Import ~/.ssh/config: ${r.added} host baru, ${r.updated} diperbarui, ${r.keys} key`)
      for (const s of r.skipped) toast(s, 'error')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const openLocal = (): void =>
    void openSession({ kind: 'adhoc', host: { label: 'Lokal', protocol: 'local', address: '' } })

  const crumbs: Group[] = []
  for (let g = group; g; g = data.groups.find((x) => x.id === g!.parentId)) crumbs.unshift(g)

  const sortHeader = (key: SortKey, label: string): React.JSX.Element => (
    <th aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        onClick={() =>
          setSort({ key, desc: sort.key === key ? !sort.desc : key === 'lastConnectedAt' })
        }
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  return (
    <div className="view">
      <div className="view-head">
        <h1>Hosts</h1>
        <span className="grow" />
        <input
          className="input search"
          placeholder="Cari nama, alamat, tag"
          aria-label="Cari host"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" onClick={() => setQuick(true)} title="Ctrl+K">
          Quick connect
        </button>
        <button className="btn" onClick={() => setEditingGroup({})}>
          Grup baru
        </button>
        <button className="btn primary" onClick={() => setEditing({})}>
          Host baru
        </button>
      </div>

      {!needle && (crumbs.length > 0 || groupId) && (
        <div className="row small muted" style={{ marginBottom: 10 }}>
          <button className="btn sm ghost" onClick={() => setGroupId(null)}>
            Semua host
          </button>
          {crumbs.map((c) => (
            <span key={c.id} className="row">
              /
              <button className="btn sm ghost" onClick={() => setGroupId(c.id)}>
                {c.label}
              </button>
            </span>
          ))}
          {group && (
            <>
              <span className="grow" />
              <button className="btn sm" onClick={() => setEditingGroup({ group })}>
                Edit grup
              </button>
              <button className="btn sm danger" onClick={() => removeGroup(group)}>
                Hapus grup
              </button>
            </>
          )}
        </div>
      )}

      {data.hosts.length === 0 && data.groups.length === 0 ? (
        <div className="empty">
          <p>
            Vault ini belum berisi host. Tambahkan server pertama, ambil yang sudah ada di
            ~/.ssh/config, atau mulai dengan terminal lokal.
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => setEditing({})}>
              Host baru
            </button>
            <button className="btn" onClick={importConfig}>
              Import ~/.ssh/config
            </button>
            <button className="btn" onClick={openLocal}>
              Terminal lokal
            </button>
          </div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {sortHeader('label', 'Nama')}
              {sortHeader('address', 'Alamat')}
              <th>Protokol</th>
              <th>Tag</th>
              {sortHeader('lastConnectedAt', 'Terakhir')}
              <th />
            </tr>
          </thead>
          <tbody>
            {subGroups.map((g) => (
              <tr key={g.id}>
                <td colSpan={5}>
                  <button className="btn sm ghost cell-title" onClick={() => setGroupId(g.id)}>
                    {g.label}/
                  </button>
                  <span className="dim small">
                    {' '}
                    {data.hosts.filter((h) => h.groupId === g.id).length} host
                  </span>
                </td>
                <td className="actions">
                  <button className="btn sm ghost" onClick={() => setEditingGroup({ group: g })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {hosts.map((h) => (
              <tr
                key={h.id}
                className="clickable"
                tabIndex={0}
                aria-label={`${h.label}, ${addressOf(h)}. Enter untuk menghubungkan`}
                onDoubleClick={() => connect(h)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) connect(h)
                }}
              >
                <td className="cell-title">{h.label}</td>
                <td className="mono small">{addressOf(h)}</td>
                <td className="muted">{h.protocol}</td>
                <td>
                  {h.tags.map((t) => (
                    <span key={t} className="tag" style={{ marginRight: 4 }}>
                      {t}
                    </span>
                  ))}
                </td>
                <td className="muted small">
                  {h.lastConnectedAt ? timeAgo(h.lastConnectedAt) : ''}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => connect(h)}>
                    Hubungkan
                  </button>
                  <button className="btn sm ghost" onClick={() => setEditing({ host: h })}>
                    Edit
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      void api.upsert<Host>('hosts', {
                        ...h,
                        id: crypto.randomUUID(),
                        label: h.label + ' (salinan)',
                        lastConnectedAt: undefined
                      })
                    }
                  >
                    Duplikat
                  </button>
                  <button className="btn sm ghost danger" onClick={() => removeHost(h)}>
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
            {hosts.length === 0 && subGroups.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {needle
                    ? `Tidak ada host yang cocok dengan "${q.trim()}".`
                    : 'Grup ini masih kosong.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {(data.hosts.length > 0 || data.groups.length > 0) && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn sm" onClick={importConfig}>
            Import ~/.ssh/config
          </button>
          <button className="btn sm" onClick={openLocal} title="Ctrl+Shift+T">
            Terminal lokal
          </button>
          <span className="dim small">
            Klik dua kali atau tekan Enter pada baris untuk menghubungkan.
          </span>
        </div>
      )}

      {editing && (
        <HostEditor
          host={editing.host}
          groupId={groupId ?? undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {editingGroup && (
        <GroupEditor group={editingGroup.group} onClose={() => setEditingGroup(null)} />
      )}
      {quick && (
        <HostPicker
          title="Quick connect"
          onClose={() => setQuick(false)}
          onPick={(h) => {
            setQuick(false)
            connect(h)
          }}
          onAdhoc={(spec) => {
            setQuick(false)
            void openSession({
              kind: 'adhoc',
              host: {
                label: spec.address,
                address: spec.address,
                protocol: 'ssh',
                config: { username: spec.username, port: spec.port }
              }
            })
          }}
        />
      )}
    </div>
  )
}

function addressOrLabel(h: Host, key: 'label' | 'address'): string {
  return key === 'label' ? h.label : addressOf(h)
}
