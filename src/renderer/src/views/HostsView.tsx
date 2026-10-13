import { useMemo, useState } from 'react'
import type { Group, Host } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { Avatar } from '../components/ui'
import { confirmDialog, timeAgo } from '../lib'
import { HostPicker } from '../components/HostPicker'
import { GroupEditor, HostEditor } from './HostEditor'

const PROTO_ICON: Record<string, string> = {
  ssh: '›_',
  mosh: 'M',
  telnet: 'T',
  serial: '⏚',
  local: '⌂'
}

export function HostsView(): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const { openSession, toast } = useStore.getState()
  const [q, setQ] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ host?: Host } | null>(null)
  const [editingGroup, setEditingGroup] = useState<{ group?: Group } | null>(null)
  const [quick, setQuick] = useState(false)

  const group = data.groups.find((g) => g.id === groupId)
  const subGroups = data.groups.filter((g) => (g.parentId ?? null) === groupId)
  const needle = q.trim().toLowerCase()
  const hosts = useMemo(
    () =>
      data.hosts
        .filter((h) =>
          needle
            ? h.label.toLowerCase().includes(needle) ||
              h.address.toLowerCase().includes(needle) ||
              h.tags.some((t) => t.toLowerCase().includes(needle))
            : (h.groupId ?? null) === groupId
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data.hosts, needle, groupId]
  )
  const recent = useMemo(
    () =>
      data.hosts
        .filter((h) => h.lastConnectedAt)
        .sort((a, b) => b.lastConnectedAt! - a.lastConnectedAt!)
        .slice(0, 6),
    [data.hosts]
  )

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

  const crumbs: Group[] = []
  for (let g = group; g; g = data.groups.find((x) => x.id === g!.parentId)) crumbs.unshift(g)

  return (
    <div className="view">
      <div className="view-head">
        <h1>Hosts</h1>
        <span className="grow" />
        <input
          className="input search"
          placeholder="Cari nama, alamat, tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" onClick={() => setQuick(true)} title="Ctrl+K">
          ⚡ Quick connect
        </button>
        <button className="btn" onClick={() => setEditingGroup({})}>
          + Grup
        </button>
        <button className="btn primary" onClick={() => setEditing({})}>
          + Host
        </button>
      </div>

      {!needle && (
        <div className="row small muted" style={{ marginBottom: 12 }}>
          <a style={{ cursor: 'pointer' }} onClick={() => setGroupId(null)}>
            Semua
          </a>
          {crumbs.map((c) => (
            <span key={c.id} className="row">
              ›
              <a style={{ cursor: 'pointer' }} onClick={() => setGroupId(c.id)}>
                {c.label}
              </a>
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

      {!needle && !groupId && recent.length > 0 && (
        <>
          <div className="section-title">Terakhir dipakai</div>
          <div className="card-grid">
            {recent.map((h) => (
              <div
                key={h.id}
                className="card"
                onDoubleClick={() => connect(h)}
                onClick={() => connect(h)}
              >
                <Avatar text={h.label} icon={PROTO_ICON[h.protocol]} />
                <div className="body">
                  <div className="title">{h.label}</div>
                  <div className="sub">{timeAgo(h.lastConnectedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!needle && subGroups.length > 0 && (
        <>
          <div className="section-title">Grup</div>
          <div className="card-grid">
            {subGroups.map((g) => (
              <div key={g.id} className="card" onClick={() => setGroupId(g.id)}>
                <Avatar text={g.label} icon="▤" />
                <div className="body">
                  <div className="title">{g.label}</div>
                  <div className="sub">
                    {data.hosts.filter((h) => h.groupId === g.id).length} host
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{needle ? 'Hasil pencarian' : 'Host'}</div>
      {hosts.length === 0 ? (
        data.hosts.length === 0 ? (
          <div className="empty">
            <div className="big">🖥️</div>
            <div style={{ marginBottom: 14 }}>Belum ada host. Tambahkan server pertamamu.</div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setEditing({})}>
                + Host baru
              </button>
              <button className="btn" onClick={importConfig}>
                Import dari ~/.ssh/config
              </button>
              <button
                className="btn"
                onClick={() =>
                  void openSession({
                    kind: 'adhoc',
                    host: { label: 'Lokal', protocol: 'local', address: '' }
                  })
                }
              >
                Terminal lokal
              </button>
            </div>
          </div>
        ) : (
          <div className="dim small">Tidak ada host di sini.</div>
        )
      ) : (
        <div className="card-grid">
          {hosts.map((h) => (
            <div key={h.id} className="card" onDoubleClick={() => connect(h)}>
              <Avatar text={h.label} icon={PROTO_ICON[h.protocol]} />
              <div className="body">
                <div className="title">{h.label}</div>
                <div className="sub">
                  {h.protocol === 'local'
                    ? 'terminal lokal'
                    : `${h.protocol} · ${h.config.username ? h.config.username + '@' : ''}${h.address}`}
                </div>
                {h.tags.length > 0 && (
                  <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    {h.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="actions">
                <button className="btn sm primary" onClick={() => connect(h)} title="Hubungkan">
                  ▶
                </button>
                <button className="btn sm" onClick={() => setEditing({ host: h })} title="Edit">
                  ✎
                </button>
                <button
                  className="btn sm"
                  title="Duplikat"
                  onClick={() =>
                    void api.upsert<Host>('hosts', {
                      ...h,
                      id: crypto.randomUUID(),
                      label: h.label + ' (salinan)',
                      lastConnectedAt: undefined
                    })
                  }
                >
                  ⧉
                </button>
                <button className="btn sm danger" onClick={() => removeHost(h)} title="Hapus">
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.hosts.length > 0 && (
        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn sm" onClick={importConfig}>
            Import dari ~/.ssh/config
          </button>
          <button
            className="btn sm"
            onClick={() =>
              void openSession({
                kind: 'adhoc',
                host: { label: 'Lokal', protocol: 'local', address: '' }
              })
            }
          >
            Buka terminal lokal
          </button>
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
