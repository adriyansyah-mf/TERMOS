import { useMemo, useState } from 'react'
import type { Group, Host } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { confirmDialog, promptOne, timeAgo } from '../lib'
import { HostPicker } from '../components/HostPicker'
import { GroupEditor, HostEditor } from './HostEditor'
import { fmt, useT } from '../i18n'

type SortKey = 'label' | 'address' | 'lastConnectedAt'

const S = {
  id: {
    localAddress: 'terminal lokal',
    removeHostTitle: 'Hapus host',
    remove: 'Hapus',
    removeHostQ: 'Hapus "%s"?',
    removeGroupTitle: 'Hapus grup',
    removeGroupQ: 'Hapus grup "%s"? %s host di dalamnya dipindah keluar grup.',
    imported: 'Import ~/.ssh/config: %s host baru, %s diperbarui, %s key',
    local: 'Lokal',
    joinShared: 'Gabung sesi bersama',
    joinSharedPrompt: 'Link dari rekan (https://server/share/…#kunci)',
    hosts: 'Hosts',
    searchPlaceholder: 'Cari nama, alamat, tag',
    searchLabel: 'Cari host',
    quickConnect: 'Quick connect',
    newGroup: 'Grup baru',
    newHost: 'Host baru',
    allHosts: 'Semua host',
    editGroup: 'Edit grup',
    emptyVault:
      'Vault ini belum berisi host. Tambahkan server pertama, ambil yang sudah ada di ~/.ssh/config, atau mulai dengan terminal lokal.',
    importSsh: 'Import ~/.ssh/config',
    localTerminal: 'Terminal lokal',
    name: 'Nama',
    address: 'Alamat',
    protocol: 'Protokol',
    tag: 'Tag',
    lastUsed: 'Terakhir',
    hostCount: '%s host',
    edit: 'Edit',
    connect: 'Hubungkan',
    duplicate: 'Duplikat',
    copySuffix: ' (salinan)',
    noMatch: 'Tidak ada host yang cocok dengan "%s".',
    groupEmpty: 'Grup ini masih kosong.',
    rowHint: 'Klik dua kali atau tekan Enter pada baris untuk menghubungkan.',
    rowAria: '%s, %s. Enter untuk menghubungkan'
  },
  en: {
    localAddress: 'local terminal',
    removeHostTitle: 'Remove host',
    remove: 'Remove',
    removeHostQ: 'Remove "%s"?',
    removeGroupTitle: 'Remove group',
    removeGroupQ: 'Remove group "%s"? Its %s hosts will be moved out of the group.',
    imported: 'Imported ~/.ssh/config: %s new hosts, %s updated, %s keys',
    local: 'Local',
    joinShared: 'Join shared session',
    joinSharedPrompt: 'Link from a teammate (https://server/share/…#key)',
    hosts: 'Hosts',
    searchPlaceholder: 'Search name, address, tags',
    searchLabel: 'Search hosts',
    quickConnect: 'Quick connect',
    newGroup: 'New group',
    newHost: 'New host',
    allHosts: 'All hosts',
    editGroup: 'Edit group',
    emptyVault:
      'This vault has no hosts yet. Add your first server, pull in existing ones from ~/.ssh/config, or start with a local terminal.',
    importSsh: 'Import ~/.ssh/config',
    localTerminal: 'Local terminal',
    name: 'Name',
    address: 'Address',
    protocol: 'Protocol',
    tag: 'Tags',
    lastUsed: 'Last used',
    hostCount: '%s hosts',
    edit: 'Edit',
    connect: 'Connect',
    duplicate: 'Duplicate',
    copySuffix: ' (copy)',
    noMatch: 'No hosts match "%s".',
    groupEmpty: 'This group is empty.',
    rowHint: 'Double-click a row or press Enter to connect.',
    rowAria: '%s, %s. Enter to connect'
  }
}

function addressOf(h: Host): string {
  if (h.protocol === 'local') return S[useStore.getState().lang].localAddress
  if (h.protocol === 'serial')
    return `${h.serial?.path ?? h.address} @ ${h.serial?.baudRate ?? 9600}`
  const port = h.config.port ? `:${h.config.port}` : ''
  return `${h.config.username ? h.config.username + '@' : ''}${h.address}${port}`
}

export function HostsView(): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const { openSession, toast } = useStore.getState()
  const t = useT(S)
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
          h.tags.some((tag) => tag.toLowerCase().includes(needle))
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
      await confirmDialog(t.removeHostTitle, fmt(t.removeHostQ, h.label), {
        danger: true,
        okLabel: t.remove
      })
    )
      await api.remove('hosts', h.id)
  }

  const removeGroup = async (g: Group): Promise<void> => {
    const count = data.hosts.filter((h) => h.groupId === g.id).length
    const ok = await confirmDialog(
      t.removeGroupTitle,
      fmt(t.removeGroupQ, g.label, String(count)),
      { danger: true, okLabel: t.remove }
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
      toast(fmt(t.imported, String(r.added), String(r.updated), String(r.keys)))
      for (const s of r.skipped) toast(s, 'error')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const openLocal = (): void =>
    void openSession({
      kind: 'adhoc',
      host: { label: t.local, protocol: 'local', address: '' }
    })

  const joinShared = async (): Promise<void> => {
    const invite = await promptOne(t.joinShared, t.joinSharedPrompt)
    if (invite?.trim()) void openSession({ kind: 'multiplayer', invite: invite.trim() })
  }

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
        <h1>{t.hosts}</h1>
        <span className="grow" />
        <input
          className="input search"
          placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" onClick={() => setQuick(true)} title="Ctrl+K">
          {t.quickConnect}
        </button>
        <button className="btn" onClick={() => setEditingGroup({})}>
          {t.newGroup}
        </button>
        <button className="btn primary" onClick={() => setEditing({})}>
          {t.newHost}
        </button>
      </div>

      {!needle && (crumbs.length > 0 || groupId) && (
        <div className="row small muted" style={{ marginBottom: 10 }}>
          <button className="btn sm ghost" onClick={() => setGroupId(null)}>
            {t.allHosts}
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
                {t.editGroup}
              </button>
              <button className="btn sm danger" onClick={() => removeGroup(group)}>
                {t.removeGroupTitle}
              </button>
            </>
          )}
        </div>
      )}

      {data.hosts.length === 0 && data.groups.length === 0 ? (
        <div className="empty">
          <p>{t.emptyVault}</p>
          <div className="row">
            <button className="btn primary" onClick={() => setEditing({})}>
              {t.newHost}
            </button>
            <button className="btn" onClick={importConfig}>
              {t.importSsh}
            </button>
            <button className="btn" onClick={openLocal}>
              {t.localTerminal}
            </button>
            <button className="btn" onClick={joinShared}>
              {t.joinShared}
            </button>
          </div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {sortHeader('label', t.name)}
              {sortHeader('address', t.address)}
              <th>{t.protocol}</th>
              <th>{t.tag}</th>
              {sortHeader('lastConnectedAt', t.lastUsed)}
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
                    {fmt(t.hostCount, String(data.hosts.filter((h) => h.groupId === g.id).length))}
                  </span>
                </td>
                <td className="actions">
                  <button className="btn sm ghost" onClick={() => setEditingGroup({ group: g })}>
                    {t.edit}
                  </button>
                </td>
              </tr>
            ))}
            {hosts.map((h) => (
              <tr
                key={h.id}
                className="clickable"
                tabIndex={0}
                aria-label={fmt(t.rowAria, h.label, addressOf(h))}
                onDoubleClick={() => connect(h)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) connect(h)
                }}
              >
                <td className="cell-title">{h.label}</td>
                <td className="mono small">{addressOf(h)}</td>
                <td className="muted">{h.protocol}</td>
                <td>
                  {h.tags.map((tag) => (
                    <span key={tag} className="tag" style={{ marginRight: 4 }}>
                      {tag}
                    </span>
                  ))}
                </td>
                <td className="muted small">
                  {h.lastConnectedAt ? timeAgo(h.lastConnectedAt) : ''}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => connect(h)}>
                    {t.connect}
                  </button>
                  <button className="btn sm ghost" onClick={() => setEditing({ host: h })}>
                    {t.edit}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      void api.upsert<Host>('hosts', {
                        ...h,
                        id: crypto.randomUUID(),
                        label: h.label + t.copySuffix,
                        lastConnectedAt: undefined
                      })
                    }
                  >
                    {t.duplicate}
                  </button>
                  <button className="btn sm ghost danger" onClick={() => removeHost(h)}>
                    {t.remove}
                  </button>
                </td>
              </tr>
            ))}
            {hosts.length === 0 && subGroups.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {needle ? fmt(t.noMatch, q.trim()) : t.groupEmpty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {(data.hosts.length > 0 || data.groups.length > 0) && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn sm" onClick={importConfig}>
            {t.importSsh}
          </button>
          <button className="btn sm" onClick={openLocal} title="Ctrl+Shift+T">
            {t.localTerminal}
          </button>
          <button className="btn sm" onClick={joinShared}>
            {t.joinShared}
          </button>
          <span className="dim small">{t.rowHint}</span>
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
          title={t.quickConnect}
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
