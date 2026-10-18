import { useCallback, useEffect, useState } from 'react'
import type { TransferProgress } from '../../../shared/api'
import type { SftpEntry } from '../../../shared/types'
import { api, bridge, errMsg } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Modal } from './ui'
import { confirmDialog, formatBytes, promptOne } from '../lib'

const S = {
  id: {
    saved: 'Tersimpan',
    cancel: 'Batal',
    save: 'Simpan',
    loading: 'Memuat…',
    closeSftp: 'Tutup SFTP',
    up: 'Atas',
    parentFolder: 'Folder atas',
    reload: 'Muat ulang',
    upload: 'Unggah',
    uploadedItemsN: '%s item diunggah',
    uploadedFilesN: '%s file diunggah',
    download: 'Unduh',
    downloadedTo: 'Diunduh ke %s',
    newFolder: 'Folder baru',
    folderName: 'Nama folder',
    rename: 'Ganti nama',
    newName: 'Nama baru',
    chmodTitle: 'Ubah izin (chmod)',
    chmodHint: 'Mode oktal, mis. 644 atau 755',
    delete: 'Hapus',
    deleteConfirmN: 'Hapus %s item? Folder dihapus beserta isinya.',
    deleted: 'Dihapus',
    hiddenFiles: 'file tersembunyi',
    connecting: 'Menghubungkan…',
    transferDone: 'selesai',
    dropHint: 'Seret file ke sini untuk mengunggah · klik dua kali file teks untuk mengedit'
  },
  en: {
    saved: 'Saved',
    cancel: 'Cancel',
    save: 'Save',
    loading: 'Loading…',
    closeSftp: 'Close SFTP',
    up: 'Up',
    parentFolder: 'Parent folder',
    reload: 'Reload',
    upload: 'Upload',
    uploadedItemsN: '%s item(s) uploaded',
    uploadedFilesN: '%s file(s) uploaded',
    download: 'Download',
    downloadedTo: 'Downloaded to %s',
    newFolder: 'New folder',
    folderName: 'Folder name',
    rename: 'Rename',
    newName: 'New name',
    chmodTitle: 'Change permissions (chmod)',
    chmodHint: 'Octal mode, e.g. 644 or 755',
    delete: 'Delete',
    deleteConfirmN: 'Delete %s item(s)? Folders are deleted with their contents.',
    deleted: 'Deleted',
    hiddenFiles: 'hidden files',
    connecting: 'Connecting…',
    transferDone: 'done',
    dropHint: 'Drag files here to upload · double-click a text file to edit'
  }
}

function modeString(mode: number): string {
  const chars = 'rwxrwxrwx'
  let s = ''
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? chars[i] : '-'
  return s
}

function Editor(props: { sftpId: string; path: string; onClose(): void }): React.JSX.Element {
  const t = useT(S)
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
      toast(t.saved)
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
            {t.cancel}
          </button>
          <button className="btn primary" disabled={saving || text === null} onClick={save}>
            {t.save}
          </button>
        </>
      }
    >
      {text === null ? (
        <div className="dim">{t.loading}</div>
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
  const t = useT(S)
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
      setTransfers((tr) => ({ ...tr, [p.transferId]: p }))
      // Successful transfers clear quickly; failures stay long enough to be read.
      if (p.finished)
        setTimeout(
          () =>
            setTransfers((tr) => {
              const n = { ...tr }
              delete n[p.transferId]
              return n
            }),
          p.error ? 10000 : 2500
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
          void run(
            () => api.sftpUploadPaths(sftpId, paths, cwd),
            fmt(t.uploadedItemsN, String(paths.length))
          )
      }}
    >
      <div className="sftp-head">
        <div className="row">
          <strong className="ellipsis">SFTP · {host?.label}</strong>
          <span className="grow" />
          <button className="btn sm ghost" onClick={props.onClose} title={t.closeSftp}>
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
          <button type="button" className="btn sm" onClick={up} title={t.parentFolder}>
            {t.up}
          </button>
          <input
            className="input mono small"
            style={{ padding: '3px 8px' }}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
          />
          <button type="button" className="btn sm" onClick={() => void load(cwd)} title={t.reload}>
            {t.reload}
          </button>
        </form>
        <div className="row wrap">
          <button
            className="btn sm"
            disabled={!sftpId}
            onClick={() =>
              void run(async () => {
                const n = await api.sftpUploadDialog(sftpId!, cwd)
                if (n) toast(fmt(t.uploadedFilesN, String(n)))
              })
            }
          >
            {t.upload}
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
                if (dir) toast(fmt(t.downloadedTo, dir))
              } catch (e) {
                toast(errMsg(e), 'error')
              }
            }}
          >
            {t.download}
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              const name = await promptOne(t.newFolder, t.folderName)
              if (name) void run(() => api.sftpMkdir(sftpId!, join(name)))
            }}
          >
            {t.newFolder}
          </button>
          <button
            className="btn sm"
            disabled={chosen.length !== 1}
            onClick={async () => {
              const e = chosen[0]
              const name = await promptOne(t.rename, t.newName, e.name)
              if (name && name !== e.name)
                void run(() => api.sftpRename(sftpId!, e.path, join(name)))
            }}
          >
            {t.rename}
          </button>
          <button
            className="btn sm"
            disabled={chosen.length !== 1}
            onClick={async () => {
              const e = chosen[0]
              const v = await promptOne(t.chmodTitle, t.chmodHint, (e.mode & 0o777).toString(8))
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
                t.delete,
                fmt(t.deleteConfirmN, String(chosen.length)),
                { danger: true, okLabel: t.delete }
              )
              if (ok)
                void run(async () => {
                  for (const c of chosen)
                    await api.sftpRemove(sftpId!, c.path, c.isDir && !c.isLink)
                }, t.deleted)
            }}
          >
            {t.delete}
          </button>
          <label className="row small dim" style={{ marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            {t.hiddenFiles}
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
            {t.connecting}
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
          {Object.values(transfers).map((tr) => (
            <div key={tr.transferId} className="row" style={{ marginBottom: 4 }}>
              <span className="ellipsis grow">{tr.name}</span>
              {tr.error ? (
                <span style={{ color: 'var(--danger)' }}>{tr.error}</span>
              ) : tr.finished ? (
                <span style={{ color: 'var(--ok)' }}>{t.transferDone}</span>
              ) : (
                <>
                  <div className="bar">
                    <div
                      style={{ width: `${Math.round((tr.done / Math.max(1, tr.total)) * 100)}%` }}
                    />
                  </div>
                  <span className="dim">{formatBytes(tr.done)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="dim small" style={{ padding: '4px 10px 8px' }}>
        {t.dropHint}
      </div>
      {editing && sftpId && (
        <Editor sftpId={sftpId} path={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
