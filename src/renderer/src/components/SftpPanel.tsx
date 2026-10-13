import { useCallback, useEffect, useState } from 'react'
import type { TransferProgress } from '../../../shared/api'
import type { SftpEntry } from '../../../shared/types'
import { api, bridge, errMsg } from '../api'
import { useStore } from '../store'
import { Modal } from './ui'
import { confirmDialog, formatBytes, promptOne } from '../lib'

function modeString(mode: number): string {
  const chars = 'rwxrwxrwx'
  let s = ''
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? chars[i] : '-'
  return s
}

function Editor(props: { sftpId: string; path: string; onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const [text, setText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.sftpReadText(props.sftpId, props.path).then(setText, (e) => {
      toast(errMsg(e), 'error')
      props.onClose()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path])
  const save = async (): Promise<void> => {
    if (text === null) return
    setSaving(true)
    try {
      await api.sftpWriteText(props.sftpId, props.path, text)
      toast('Tersimpan')
      props.onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      wide
      title={<span className="mono small">{props.path}</span>}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={saving || text === null} onClick={save}>
            Simpan
          </button>
        </>
      }
    >
      {text === null ? (
        <div className="dim">Memuat…</div>
      ) : (
        <textarea
          className="textarea"
          style={{ minHeight: '55vh' }}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 's') {
              e.preventDefault()
              void save()
            }
          }}
        />
      )}
    </Modal>
  )
}

export function SftpPanel(props: { hostId: string; onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const host = useStore((s) => s.data?.hosts.find((h) => h.id === props.hostId))
  const [sftpId, setSftpId] = useState<string | null>(null)
  const [cwd, setCwd] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => {
    let id: string | null = null
    let alive = true
    api.sftpConnect(props.hostId).then(
      (r) => {
        id = r.sftpId
        if (!alive) return void api.sftpClose(r.sftpId)
        setSftpId(r.sftpId)
        setCwd(r.home)
      },
      (e) => setError(errMsg(e))
    )
    const off = bridge.on('sftp:progress', (p) => {
      setTransfers((t) => ({ ...t, [p.transferId]: p }))
      if (p.finished && !p.error)
        setTimeout(
          () =>
            setTransfers((t) => {
              const n = { ...t }
              delete n[p.transferId]
              return n
            }),
          2500
        )
    })
    return () => {
      alive = false
      off()
      if (id) void api.sftpClose(id)
    }
  }, [props.hostId])

  const load = useCallback(
    async (dir: string) => {
      if (!sftpId) return
      try {
        const list = await api.sftpList(sftpId, dir)
        setEntries(list)
        setCwd(dir)
        setPathInput(dir)
        setSelected(new Set())
        setError(null)
      } catch (e) {
        setError(errMsg(e))
      }
    },
    [sftpId]
  )

  useEffect(() => {
    if (sftpId && cwd) void load(cwd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sftpId])

  const up = (): void => {
    const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/'
    void load(parent)
  }

  const run = async (fn: () => Promise<unknown>, okMsg?: string): Promise<void> => {
    try {
      await fn()
      if (okMsg) toast(okMsg)
      await load(cwd)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const visible = entries.filter((e) => showHidden || !e.name.startsWith('.'))
  const chosen = entries.filter((e) => selected.has(e.path))
  const join = (name: string): string => (cwd.endsWith('/') ? cwd : cwd + '/') + name

  const open = (e: SftpEntry): void => {
    if (e.isDir) void load(e.path)
    else if (e.isLink)
      void api.sftpRealpath(sftpId!, e.path).then(async (real) => {
        const dir = await api.sftpList(sftpId!, real).then(
          () => true,
          () => false
        )
        if (dir) void load(real)
        else setEditing(real)
      })
    else setEditing(e.path)
  }

  if (error && !sftpId)
    return (
      <div className="sftp">
        <div className="sftp-head row">
          <strong>SFTP</strong>
          <span className="grow" />
          <button className="btn sm ghost" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="alert error small" style={{ margin: 10 }}>
          {error}
        </div>
      </div>
    )

  return (
    <div
      className={'sftp' + (dragOver ? ' dragover' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean)
        if (paths.length && sftpId)
          void run(() => api.sftpUploadPaths(sftpId, paths, cwd), `${paths.length} item diunggah`)
      }}
    >
      <div className="sftp-head">
        <div className="row">
          <strong className="ellipsis">SFTP · {host?.label}</strong>
          <span className="grow" />
          <button className="btn sm ghost" onClick={props.onClose} title="Tutup SFTP">
            ✕
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void load(pathInput)
          }}
        >
          <button type="button" className="btn sm" onClick={up} title="Folder atas">
            Atas
          </button>
          <input
            className="input mono small"
            style={{ padding: '3px 8px' }}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
          />
          <button
            type="button"
            className="btn sm"
            onClick={() => void load(cwd)}
            title="Muat ulang"
          >
            Muat ulang
          </button>
        </form>
        <div className="row wrap">
          <button
            className="btn sm"
            disabled={!sftpId}
            onClick={() =>
              void run(async () => {
                const n = await api.sftpUploadDialog(sftpId!, cwd)
                if (n) toast(`${n} file diunggah`)
              })
            }
          >
            Unggah
          </button>
          <button
            className="btn sm"
            disabled={!chosen.length}
            onClick={async () => {
              try {
                const dir = await api.sftpDownload(
                  sftpId!,
                  chosen.map((c) => ({ path: c.path, isDir: c.isDir }))
                )
                if (dir) toast(`Diunduh ke ${dir}`)
              } catch (e) {
                toast(errMsg(e), 'error')
              }
            }}
          >
            Unduh
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              const name = await promptOne('Folder baru', 'Nama folder')
              if (name) void run(() => api.sftpMkdir(sftpId!, join(name)))
            }}
          >
            Folder baru
          </button>
          <button
            className="btn sm"
            disabled={chosen.length !== 1}
            onClick={async () => {
              const e = chosen[0]
              const name = await promptOne('Ganti nama', 'Nama baru', e.name)
              if (name && name !== e.name)
                void run(() => api.sftpRename(sftpId!, e.path, join(name)))
            }}
          >
            Ganti nama
          </button>
          <button
            className="btn sm"
            disabled={chosen.length !== 1}
            onClick={async () => {
              const e = chosen[0]
              const v = await promptOne(
                'Ubah izin (chmod)',
                'Mode oktal, mis. 644 atau 755',
                (e.mode & 0o777).toString(8)
              )
              if (v && /^[0-7]{3,4}$/.test(v))
                void run(() => api.sftpChmod(sftpId!, e.path, parseInt(v, 8)))
            }}
          >
            chmod
          </button>
          <button
            className="btn sm danger"
            disabled={!chosen.length}
            onClick={async () => {
              const ok = await confirmDialog(
                'Hapus',
                `Hapus ${chosen.length} item? Folder dihapus beserta isinya.`,
                { danger: true, okLabel: 'Hapus' }
              )
              if (ok)
                void run(async () => {
                  for (const c of chosen)
                    await api.sftpRemove(sftpId!, c.path, c.isDir && !c.isLink)
                }, 'Dihapus')
            }}
          >
            Hapus
          </button>
          <label className="row small dim" style={{ marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            file tersembunyi
          </label>
        </div>
      </div>
      {error && (
        <div className="alert error small" style={{ margin: 8 }}>
          {error}
        </div>
      )}
      <div className="sftp-list">
        {!sftpId && (
          <div className="dim small" style={{ padding: 10 }}>
            Menghubungkan…
          </div>
        )}
        {visible.map((e) => (
          <button
            key={e.path}
            className={'sftp-item' + (selected.has(e.path) ? ' selected' : '')}
            title={e.path}
            aria-pressed={selected.has(e.path)}
            onClick={(ev) => {
              const next = new Set(ev.ctrlKey || ev.metaKey ? selected : [])
              if (next.has(e.path)) next.delete(e.path)
              else next.add(e.path)
              setSelected(next)
            }}
            onDoubleClick={() => open(e)}
            onKeyDown={(ev) => {
              // Space selects (native button click); Enter opens, like a file manager.
              if (ev.key === 'Enter') {
                ev.preventDefault()
                open(e)
              }
            }}
          >
            <span className={'ellipsis' + (e.isDir ? ' cell-title' : '')}>
              {e.name}
              {e.isDir ? '/' : e.isLink ? ' @' : ''}
            </span>
            <span className="size">{e.isDir ? '' : formatBytes(e.size)}</span>
            <span className="date">{new Date(e.mtime).toLocaleDateString()}</span>
            <span className="perm">{modeString(e.mode)}</span>
          </button>
        ))}
      </div>
      {Object.values(transfers).length > 0 && (
        <div className="transfers">
          {Object.values(transfers).map((t) => (
            <div key={t.transferId} className="row" style={{ marginBottom: 4 }}>
              <span className="ellipsis grow">{t.name}</span>
              {t.error ? (
                <span style={{ color: 'var(--danger)' }}>{t.error}</span>
              ) : t.finished ? (
                <span style={{ color: 'var(--ok)' }}>selesai</span>
              ) : (
                <>
                  <div className="bar">
                    <div
                      style={{ width: `${Math.round((t.done / Math.max(1, t.total)) * 100)}%` }}
                    />
                  </div>
                  <span className="dim">{formatBytes(t.done)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="dim small" style={{ padding: '4px 10px 8px' }}>
        Seret file ke sini untuk mengunggah · klik dua kali file teks untuk mengedit
      </div>
      {editing && sftpId && (
        <Editor sftpId={sftpId} path={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
