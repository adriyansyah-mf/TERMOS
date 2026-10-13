import { Fragment, useCallback, useEffect, useState } from 'react'
import type { SyncDevice, SyncStatus } from '../../../shared/api'
import { api, bridge, errMsg } from '../api'
import { useStore } from '../store'
import { Field } from '../components/ui'
import { confirmDialog, promptDialog, promptOne, timeAgo } from '../lib'

function Connect({ onDone }: { onDone(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const lastServer = useStore((s) => s.data?.settings.sync.serverUrl ?? '')
  const lastUser = useStore((s) => s.data?.settings.sync.username ?? '')
  const lastError = useStore((s) => s.data?.settings.sync.lastError)
  const [url, setUrl] = useState(lastServer)
  const [username, setUsername] = useState(lastUser)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [invite, setInvite] = useState('')
  const [info, setInfo] = useState<{ signup: string; users: number } | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async (): Promise<void> => {
    setError(null)
    setInfo(null)
    try {
      const i = await api.syncServerInfo(url)
      setInfo(i)
      if (i.users === 0) setMode('register')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (mode === 'register') {
      if (password.length < 10) return setError('Password akun minimal 10 karakter')
      if (password !== password2) return setError('Konfirmasi password tidak sama')
    }
    setBusy(true)
    try {
      if (mode === 'register')
        await api.syncRegister(url, username.trim(), password, invite || undefined)
      else await api.syncLogin(url, username.trim(), password)
      toast(
        mode === 'register'
          ? 'Akun dibuat dan vault mulai disinkronkan'
          : 'Masuk; vault mulai disinkronkan'
      )
      onDone()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const canRegister = info ? info.signup !== 'closed' : true

  return (
    <form onSubmit={submit} style={{ maxWidth: 520 }}>
      {lastError && <div className="alert error small">{lastError}</div>}
      <Field
        label="Alamat server"
        hint="Server termos-server milikmu sendiri, misalnya https://termos.domainmu.id. http:// hanya diterima untuk localhost atau IP jaringan lokal."
      >
        <div className="row">
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://termos.example.com"
            autoFocus
          />
          <button type="button" className="btn" onClick={check} disabled={!url.trim()}>
            Cek server
          </button>
        </div>
      </Field>
      {info && (
        <p className="muted small" style={{ marginTop: -4 }}>
          Server menjawab. {info.users} akun terdaftar;{' '}
          {info.signup === 'open'
            ? 'pendaftaran terbuka.'
            : info.signup === 'invite'
              ? 'pendaftaran butuh kode undangan.'
              : 'pendaftaran ditutup, minta admin server.'}
        </p>
      )}
      <div className="row" style={{ margin: '4px 0 12px' }} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={'btn sm' + (mode === 'login' ? ' on' : '')}
          onClick={() => setMode('login')}
        >
          Masuk
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={'btn sm' + (mode === 'register' ? ' on' : '')}
          onClick={() => setMode('register')}
          disabled={!canRegister}
        >
          Daftar akun baru
        </button>
      </div>
      <Field label="Username">
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </Field>
      <Field
        label="Password akun"
        hint={
          mode === 'register'
            ? 'Berbeda dari master password vault. Minimal 10 karakter. Kalau lupa, data di server tidak bisa dipulihkan siapa pun, termasuk admin.'
            : undefined
        }
      >
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
      </Field>
      {mode === 'register' && (
        <>
          <Field label="Ulangi password akun">
            <input
              className="input"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {info?.signup === 'invite' && (
            <Field label="Kode undangan">
              <input className="input" value={invite} onChange={(e) => setInvite(e.target.value)} />
            </Field>
          )}
        </>
      )}
      {error && <div className="alert error small">{error}</div>}
      <button
        className="btn primary"
        disabled={busy || !url.trim() || !username.trim() || !password}
      >
        {busy
          ? 'Memproses (menghitung kunci, beberapa detik)'
          : mode === 'register'
            ? 'Daftar dan sinkronkan'
            : 'Masuk dan sinkronkan'}
      </button>
    </form>
  )
}

function Teams({ status }: { status: SyncStatus }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState<string | null>(null)
  const [members, setMembers] = useState<{ userId: string; username: string; role: string }[]>([])

  const loadMembers = useCallback(
    async (teamId: string) => {
      try {
        setMembers(await api.teamMembers(teamId))
      } catch (e) {
        toast(errMsg(e), 'error')
      }
    },
    [toast]
  )

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn()
      if (ok) toast(ok)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  return (
    <>
      <div className="row">
        <h2 className="section-title grow">Tim</h2>
        <button
          className="btn sm"
          onClick={async () => {
            const name = await promptOne('Tim baru', 'Nama tim')
            if (name?.trim())
              await run(() => api.teamCreate(name.trim()), `Tim "${name.trim()}" dibuat`)
          }}
        >
          Tim baru
        </button>
      </div>
      <p className="view-intro">
        Host, key, dan snippet yang disimpan di tim bisa dipakai semua anggota. Pindahkan item ke
        tim lewat kolom &quot;Disimpan di&quot; di form edit-nya.
      </p>
      {status.teams.length === 0 ? (
        <p className="muted">Belum ada tim.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tim</th>
              <th>Peranmu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {status.teams.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td className="cell-title">{t.label}</td>
                  <td className="muted">{t.role === 'owner' ? 'pemilik' : 'anggota'}</td>
                  <td className="actions">
                    <button
                      className={'btn sm' + (open === t.id ? ' on' : '')}
                      aria-expanded={open === t.id}
                      onClick={() => {
                        if (open === t.id) return setOpen(null)
                        setOpen(t.id)
                        void loadMembers(t.id)
                      }}
                    >
                      Anggota
                    </button>
                    {t.role === 'owner' ? (
                      <button
                        className="btn sm ghost danger"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            'Hapus tim',
                            `Hapus tim "${t.label}"? Semua item di tim ini terhapus dari server dan dari perangkat semua anggota.`,
                            { danger: true, okLabel: 'Hapus tim' }
                          )
                          if (ok) await run(() => api.teamDelete(t.id), 'Tim dihapus')
                        }}
                      >
                        Hapus tim
                      </button>
                    ) : (
                      <button
                        className="btn sm ghost danger"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            'Keluar dari tim',
                            `Keluar dari "${t.label}"? Item tim akan hilang dari perangkat ini.`,
                            {
                              danger: true,
                              okLabel: 'Keluar'
                            }
                          )
                          if (ok)
                            await run(async () => {
                              const self = (await api.teamMembers(t.id)).find(
                                (m) => m.username === status.username
                              )
                              if (self) await api.teamRemoveMember(t.id, self.userId)
                            }, 'Keluar dari tim')
                        }}
                      >
                        Keluar
                      </button>
                    )}
                  </td>
                </tr>
                {open === t.id && (
                  <tr>
                    <td colSpan={3} className="pve-sub">
                      <table className="simple">
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.userId}>
                              <td>{m.username}</td>
                              <td className="muted">
                                {m.role === 'owner' ? 'pemilik' : 'anggota'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {t.role === 'owner' && m.role !== 'owner' && (
                                  <button
                                    className="btn sm ghost danger"
                                    onClick={() =>
                                      run(async () => {
                                        await api.teamRemoveMember(t.id, m.userId)
                                        await loadMembers(t.id)
                                      }, `${m.username} dikeluarkan`)
                                    }
                                  >
                                    Keluarkan
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {t.role === 'owner' && (
                        <button
                          className="btn sm"
                          style={{ marginTop: 8 }}
                          onClick={async () => {
                            const u = await promptOne('Tambah anggota', 'Username di server ini')
                            if (u?.trim())
                              await run(async () => {
                                await api.teamAddMember(t.id, u.trim())
                                await loadMembers(t.id)
                              }, `${u.trim()} ditambahkan`)
                          }}
                        >
                          Tambah anggota
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export function SyncView(): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [devices, setDevices] = useState<SyncDevice[] | null>(null)

  const refresh = useCallback(async () => {
    const s = await api.syncStatus()
    setStatus(s)
    if (s.connected) api.syncDevices().then(setDevices, () => setDevices(null))
  }, [])

  useEffect(() => {
    void refresh()
    return bridge.on('sync:status', (s) => setStatus(s))
  }, [refresh])

  if (!status) return <div className="view muted">Memuat</div>

  return (
    <div className="view" style={{ maxWidth: 860 }}>
      <div className="view-head">
        <h1>Sync</h1>
        <span className="grow" />
        {status.connected && (
          <button
            className="btn primary"
            disabled={status.syncing}
            onClick={() => void api.syncNow()}
          >
            {status.syncing ? 'Menyinkronkan' : 'Sync sekarang'}
          </button>
        )}
      </div>

      {!status.connected ? (
        <>
          <p className="view-intro">
            Sinkronkan vault antar perangkat dan berbagi host dengan tim lewat server milikmu
            sendiri (termos-server). Isi vault dienkripsi di perangkat ini sebelum dikirim; server
            hanya menyimpan data terenkripsi.
          </p>
          <Connect onDone={() => void refresh()} />
        </>
      ) : (
        <>
          <table className="table" style={{ maxWidth: 640 }}>
            <tbody>
              <tr>
                <td className="muted">Server</td>
                <td className="mono small">{status.serverUrl}</td>
              </tr>
              <tr>
                <td className="muted">Akun</td>
                <td>
                  {status.username}
                  {status.isAdmin ? <span className="muted"> (admin server)</span> : null}
                </td>
              </tr>
              <tr>
                <td className="muted">Sync terakhir</td>
                <td>{status.lastSyncAt ? timeAgo(status.lastSyncAt) : 'belum pernah'}</td>
              </tr>
              {status.lastError && (
                <tr>
                  <td className="muted">Galat terakhir</td>
                  <td style={{ color: 'var(--danger)' }}>{status.lastError}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small">
            Riwayat perintah dan pengaturan tampilan tidak ikut disinkronkan.
          </p>

          <Teams status={status} />

          <h2 className="section-title">Perangkat</h2>
          {devices === null ? (
            <p className="muted">Daftar perangkat tidak bisa dimuat.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Terakhir aktif</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      {d.current ? <span className="muted"> (perangkat ini)</span> : null}
                    </td>
                    <td className="muted">{timeAgo(d.lastSeen)}</td>
                    <td className="actions">
                      {!d.current && (
                        <button
                          className="btn sm ghost danger"
                          onClick={async () => {
                            if (
                              !(await confirmDialog(
                                'Cabut perangkat',
                                `Cabut "${d.name}"? Perangkat itu harus login lagi.`,
                                { danger: true, okLabel: 'Cabut' }
                              ))
                            )
                              return
                            try {
                              await api.syncRevokeDevice(d.id)
                              await refresh()
                            } catch (e) {
                              toast(errMsg(e), 'error')
                            }
                          }}
                        >
                          Cabut
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="section-title">Akun</h2>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                const r = await promptDialog(
                  'Ganti password akun sync',
                  [
                    { key: 'old', label: 'Password akun lama', type: 'password' },
                    { key: 'a', label: 'Password baru (min. 10 karakter)', type: 'password' },
                    { key: 'b', label: 'Ulangi password baru', type: 'password' }
                  ],
                  'Ganti'
                )
                if (!r) return
                if (r.a.length < 10 || r.a !== r.b)
                  return toast('Password baru tidak valid atau tidak sama', 'error')
                try {
                  await api.syncChangePassword(r.old, r.a)
                  toast('Password akun diganti. Perangkat lain harus login lagi.')
                  await refresh()
                } catch (e) {
                  toast(errMsg(e), 'error')
                }
              }}
            >
              Ganti password akun
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                const ok = await confirmDialog(
                  'Keluar dari sync',
                  'Vault pribadi di perangkat ini tetap ada. Item milik tim akan dihapus dari perangkat ini.',
                  { okLabel: 'Keluar' }
                )
                if (ok) {
                  await api.syncLogout()
                  await refresh()
                }
              }}
            >
              Keluar dari sync
            </button>
          </div>
        </>
      )}
    </div>
  )
}
