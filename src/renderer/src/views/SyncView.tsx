import { Fragment, useCallback, useEffect, useState } from 'react'
import type { SyncDevice, SyncStatus } from '../../../shared/api'
import { api, bridge, errMsg } from '../api'
import { useT, fmt } from '../i18n'
import { useStore } from '../store'
import { Field } from '../components/ui'
import { confirmDialog, promptDialog, promptOne, timeAgo } from '../lib'
import { SyncAdmin } from './SyncAdmin'

const S = {
  id: {
    pwMin: 'Password akun minimal 10 karakter',
    pwMismatch: 'Konfirmasi password tidak sama',
    registeredToast: 'Akun dibuat dan vault mulai disinkronkan',
    loginToast: 'Masuk; vault mulai disinkronkan',
    serverAddr: 'Alamat server',
    serverAddrHint:
      'Server termos-server milikmu sendiri, misalnya https://termos.domainmu.id. http:// hanya diterima untuk localhost atau IP jaringan lokal.',
    checkServer: 'Cek server',
    serverOk: 'Server menjawab. %s akun terdaftar;',
    signupOpen: 'pendaftaran terbuka.',
    signupInvite: 'pendaftaran butuh kode undangan.',
    signupClosed: 'pendaftaran ditutup oleh admin server.',
    login: 'Masuk',
    registerTab: 'Daftar akun baru',
    username: 'Username',
    accountPw: 'Password akun',
    accountPwHint:
      'Berbeda dari master password vault. Minimal 10 karakter. Kalau lupa, data di server tidak bisa dipulihkan siapa pun, termasuk admin.',
    accountPw2: 'Ulangi password akun',
    inviteCode: 'Kode undangan',
    inviteCodeHint: 'Minta ke admin server. Kosongkan kalau server membuka pendaftaran.',
    busy: 'Memproses (menghitung kunci, beberapa detik)',
    registerSync: 'Daftar dan sinkronkan',
    loginSync: 'Masuk dan sinkronkan',
    teams: 'Tim',
    newTeam: 'Tim baru',
    teamName: 'Nama tim',
    teamCreated: 'Tim "%s" dibuat',
    teamsIntro:
      'Host, key, dan snippet yang disimpan di tim bisa dipakai semua anggota. Pindahkan item ke tim lewat kolom "Disimpan di" di form edit-nya.',
    noTeams: 'Belum ada tim.',
    thTeam: 'Tim',
    thYourRole: 'Peranmu',
    owner: 'pemilik',
    member: 'anggota',
    members: 'Anggota',
    deleteTeam: 'Hapus tim',
    deleteTeamMsg:
      'Hapus tim "%s"? Semua item di tim ini terhapus dari server dan dari perangkat semua anggota.',
    teamDeleted: 'Tim dihapus',
    leaveTeam: 'Keluar dari tim',
    leaveTeamMsg: 'Keluar dari "%s"? Item tim akan hilang dari perangkat ini.',
    leave: 'Keluar',
    removeMember: 'Keluarkan',
    memberRemoved: '%s dikeluarkan',
    addMember: 'Tambah anggota',
    memberUserLabel: 'Username di server ini',
    fpConfirmTitle: 'Cocokkan fingerprint %s',
    fpConfirmIntro:
      'Minta %s membuka Sync & tim dan membacakan fingerprint akunnya lewat jalur lain (telepon, chat). Lanjutkan hanya kalau sama persis:',
    fpMismatchWarn:
      'Kalau berbeda, server memberikan kunci orang lain dan kunci tim bisa jatuh ke pihak yang salah.',
    fpOk: 'Fingerprint cocok, tambahkan',
    memberAdded: '%s ditambahkan',
    accountFpTitle: 'Fingerprint kunci akun',
    loading: 'Memuat',
    syncing: 'Menyinkronkan',
    syncNow: 'Sync sekarang',
    intro:
      'Sinkronkan vault antar perangkat dan berbagi host dengan tim lewat server milikmu sendiri (termos-server). Isi vault dienkripsi di perangkat ini sebelum dikirim; server hanya menyimpan data terenkripsi.',
    server: 'Server',
    account: 'Akun',
    serverAdmin: ' (admin server)',
    yourFp: 'Fingerprint akunmu',
    fpHint:
      'Bacakan ini ke pemilik tim saat diundang, supaya mereka bisa memastikan kuncinya benar milikmu.',
    lastSync: 'Sync terakhir',
    never: 'belum pernah',
    lastError: 'Galat terakhir',
    notSyncedNote: 'Riwayat perintah dan pengaturan tampilan tidak ikut disinkronkan.',
    devices: 'Perangkat',
    devicesLoadFail: 'Daftar perangkat tidak bisa dimuat.',
    thName: 'Nama',
    thLastActive: 'Terakhir aktif',
    thisDevice: ' (perangkat ini)',
    revokeDevice: 'Cabut perangkat',
    revokeDeviceMsg: 'Cabut "%s"? Perangkat itu harus login lagi.',
    revoke: 'Cabut',
    changePwTitle: 'Ganti password akun sync',
    oldPw: 'Password akun lama',
    newPw: 'Password baru (min. 10 karakter)',
    newPw2: 'Ulangi password baru',
    change: 'Ganti',
    invalidNewPw: 'Password baru tidak valid atau tidak sama',
    pwChanged: 'Password akun diganti. Perangkat lain harus login lagi.',
    changePwBtn: 'Ganti password akun',
    logoutTitle: 'Keluar dari sync',
    logoutMsg:
      'Vault pribadi di perangkat ini tetap ada. Item milik tim akan dihapus dari perangkat ini.',
    logoutSync: 'Keluar dari sync'
  },
  en: {
    pwMin: 'Account password must be at least 10 characters',
    pwMismatch: 'Passwords do not match',
    registeredToast: 'Account created and vault is now syncing',
    loginToast: 'Logged in; vault is now syncing',
    serverAddr: 'Server address',
    serverAddrHint:
      'Your own termos-server, for example https://termos.domainmu.id. http:// is only accepted for localhost or local network IPs.',
    checkServer: 'Check server',
    serverOk: 'Server responded. Accounts: %s;',
    signupOpen: 'sign-up is open.',
    signupInvite: 'sign-up requires an invite code.',
    signupClosed: 'sign-up has been closed by the server admin.',
    login: 'Log in',
    registerTab: 'Register new account',
    username: 'Username',
    accountPw: 'Account password',
    accountPwHint:
      'Different from the vault master password. Minimum 10 characters. If you forget it, no one can recover the data on the server, not even the admin.',
    accountPw2: 'Repeat account password',
    inviteCode: 'Invite code',
    inviteCodeHint: 'Ask the server admin. Leave empty if the server has open sign-up.',
    busy: 'Working (deriving keys, a few seconds)',
    registerSync: 'Register and sync',
    loginSync: 'Log in and sync',
    teams: 'Teams',
    newTeam: 'New team',
    teamName: 'Team name',
    teamCreated: 'Team "%s" created',
    teamsIntro:
      'Hosts, keys, and snippets stored in a team are available to all members. Move items into a team via the "Stored in" field in their edit form.',
    noTeams: 'No teams yet.',
    thTeam: 'Team',
    thYourRole: 'Your role',
    owner: 'owner',
    member: 'member',
    members: 'Members',
    deleteTeam: 'Delete team',
    deleteTeamMsg:
      'Delete team "%s"? All items in this team are deleted from the server and from the devices of every member.',
    teamDeleted: 'Team deleted',
    leaveTeam: 'Leave team',
    leaveTeamMsg: 'Leave "%s"? Team items will disappear from this device.',
    leave: 'Leave',
    removeMember: 'Remove',
    memberRemoved: '%s removed',
    addMember: 'Add member',
    memberUserLabel: 'Username on this server',
    fpConfirmTitle: "Verify %s's fingerprint",
    fpConfirmIntro:
      'Ask %s to open Sync & teams and read their account fingerprint to you over another channel (phone, chat). Continue only if it matches exactly:',
    fpMismatchWarn:
      "If it differs, the server is handing you someone else's key and the team key could end up with the wrong party.",
    fpOk: 'Fingerprint matches, add',
    memberAdded: '%s added',
    accountFpTitle: 'Account key fingerprint',
    loading: 'Loading',
    syncing: 'Syncing',
    syncNow: 'Sync now',
    intro:
      'Sync your vault across devices and share hosts with your team through your own server (termos-server). Vault contents are encrypted on this device before upload; the server only stores encrypted data.',
    server: 'Server',
    account: 'Account',
    serverAdmin: ' (server admin)',
    yourFp: 'Your account fingerprint',
    fpHint:
      'Read this to the team owner when invited, so they can confirm the key really belongs to you.',
    lastSync: 'Last sync',
    never: 'never',
    lastError: 'Last error',
    notSyncedNote: 'Command history and display settings are not synced.',
    devices: 'Devices',
    devicesLoadFail: 'Device list could not be loaded.',
    thName: 'Name',
    thLastActive: 'Last active',
    thisDevice: ' (this device)',
    revokeDevice: 'Revoke device',
    revokeDeviceMsg: 'Revoke "%s"? That device will have to log in again.',
    revoke: 'Revoke',
    changePwTitle: 'Change sync account password',
    oldPw: 'Current account password',
    newPw: 'New password (min. 10 characters)',
    newPw2: 'Repeat new password',
    change: 'Change',
    invalidNewPw: 'New password is invalid or does not match',
    pwChanged: 'Account password changed. Other devices must log in again.',
    changePwBtn: 'Change account password',
    logoutTitle: 'Log out of sync',
    logoutMsg:
      'The private vault on this device stays. Team items will be removed from this device.',
    logoutSync: 'Log out of sync'
  }
}

function Connect({ onDone }: { onDone(): void }): React.JSX.Element {
  const t = useT(S)
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

  const check = useCallback(
    async (quiet = false): Promise<void> => {
      if (!quiet) setError(null)
      setInfo(null)
      try {
        const i = await api.syncServerInfo(url)
        setInfo(i)
        if (i.users === 0) setMode('register')
      } catch (e) {
        if (!quiet) setError(errMsg(e))
      }
    },
    [url]
  )

  // Look the server up while the address is typed, so the form knows whether sign-up
  // needs an invite code; info for a previous address must never linger.
  useEffect(() => {
    setInfo(null)
    if (!url.trim()) return
    const timer = setTimeout(() => void check(true), 600)
    return () => clearTimeout(timer)
  }, [url, check])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (mode === 'register') {
      if (password.length < 10) return setError(t.pwMin)
      if (password !== password2) return setError(t.pwMismatch)
    }
    if (mode === 'register' && info?.signup === 'closed') return setError(t.signupClosed)
    setBusy(true)
    try {
      if (mode === 'register')
        await api.syncRegister(url, username.trim(), password, invite.trim() || undefined)
      else await api.syncLogin(url, username.trim(), password)
      toast(mode === 'register' ? t.registeredToast : t.loginToast)
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
      <Field label={t.serverAddr} hint={t.serverAddrHint}>
        <div className="row">
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://termos.example.com"
            autoFocus
          />
          <button type="button" className="btn" onClick={() => void check()} disabled={!url.trim()}>
            {t.checkServer}
          </button>
        </div>
      </Field>
      {info && (
        <p className="muted small" style={{ marginTop: -4 }}>
          {fmt(t.serverOk, String(info.users))}{' '}
          {info.signup === 'open'
            ? t.signupOpen
            : info.signup === 'invite'
              ? t.signupInvite
              : t.signupClosed}
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
          {t.login}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={'btn sm' + (mode === 'register' ? ' on' : '')}
          onClick={() => setMode('register')}
          disabled={!canRegister}
        >
          {t.registerTab}
        </button>
      </div>
      <Field label={t.username}>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </Field>
      <Field label={t.accountPw} hint={mode === 'register' ? t.accountPwHint : undefined}>
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
          <Field label={t.accountPw2}>
            <input
              className="input"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {info?.signup !== 'open' && (
            <Field label={t.inviteCode} hint={info ? undefined : t.inviteCodeHint}>
              <input
                className="input mono"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
        </>
      )}
      {error && <div className="alert error small">{error}</div>}
      <button
        className="btn primary"
        disabled={busy || !url.trim() || !username.trim() || !password}
      >
        {busy ? t.busy : mode === 'register' ? t.registerSync : t.loginSync}
      </button>
    </form>
  )
}

function Teams({ status }: { status: SyncStatus }): React.JSX.Element {
  const t = useT(S)
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState<string | null>(null)
  const [members, setMembers] = useState<
    { userId: string; username: string; role: string; fingerprint: string }[]
  >([])

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
        <h2 className="section-title grow">{t.teams}</h2>
        <button
          className="btn sm"
          onClick={async () => {
            const name = await promptOne(t.newTeam, t.teamName)
            if (name?.trim())
              await run(() => api.teamCreate(name.trim()), fmt(t.teamCreated, name.trim()))
          }}
        >
          {t.newTeam}
        </button>
      </div>
      <p className="view-intro">{t.teamsIntro}</p>
      {status.teams.length === 0 ? (
        <p className="muted">{t.noTeams}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.thTeam}</th>
              <th>{t.thYourRole}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {status.teams.map((team) => (
              <Fragment key={team.id}>
                <tr>
                  <td className="cell-title">{team.label}</td>
                  <td className="muted">{team.role === 'owner' ? t.owner : t.member}</td>
                  <td className="actions">
                    <button
                      className={'btn sm' + (open === team.id ? ' on' : '')}
                      aria-expanded={open === team.id}
                      onClick={() => {
                        if (open === team.id) return setOpen(null)
                        setOpen(team.id)
                        void loadMembers(team.id)
                      }}
                    >
                      {t.members}
                    </button>
                    {team.role === 'owner' ? (
                      <button
                        className="btn sm ghost danger"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            t.deleteTeam,
                            fmt(t.deleteTeamMsg, team.label),
                            { danger: true, okLabel: t.deleteTeam }
                          )
                          if (ok) await run(() => api.teamDelete(team.id), t.teamDeleted)
                        }}
                      >
                        {t.deleteTeam}
                      </button>
                    ) : (
                      <button
                        className="btn sm ghost danger"
                        onClick={async () => {
                          const ok = await confirmDialog(
                            t.leaveTeam,
                            fmt(t.leaveTeamMsg, team.label),
                            {
                              danger: true,
                              okLabel: t.leave
                            }
                          )
                          if (ok)
                            await run(async () => {
                              if (status.userId) await api.teamRemoveMember(team.id, status.userId)
                            }, t.leaveTeam)
                        }}
                      >
                        {t.leave}
                      </button>
                    )}
                  </td>
                </tr>
                {open === team.id && (
                  <tr>
                    <td colSpan={3} className="pve-sub">
                      <table className="simple">
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.userId}>
                              <td>{m.username}</td>
                              <td className="muted">{m.role === 'owner' ? t.owner : t.member}</td>
                              <td className="fp muted" title={t.accountFpTitle}>
                                {m.fingerprint}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {team.role === 'owner' && m.role !== 'owner' && (
                                  <button
                                    className="btn sm ghost danger"
                                    onClick={() =>
                                      run(
                                        async () => {
                                          await api.teamRemoveMember(team.id, m.userId)
                                          await loadMembers(team.id)
                                        },
                                        fmt(t.memberRemoved, m.username)
                                      )
                                    }
                                  >
                                    {t.removeMember}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {team.role === 'owner' && (
                        <button
                          className="btn sm"
                          style={{ marginTop: 8 }}
                          onClick={async () => {
                            const u = (await promptOne(t.addMember, t.memberUserLabel))?.trim()
                            if (!u) return
                            let preview: { username: string; fingerprint: string }
                            try {
                              preview = await api.teamPreviewMember(u)
                            } catch (e) {
                              return toast(errMsg(e), 'error')
                            }
                            const ok = await confirmDialog(
                              fmt(t.fpConfirmTitle, preview.username),
                              <>
                                <p style={{ marginTop: 0 }}>
                                  {fmt(t.fpConfirmIntro, preview.username)}
                                </p>
                                <p className="fp" style={{ fontSize: 15 }}>
                                  {preview.fingerprint}
                                </p>
                                <p className="small">{t.fpMismatchWarn}</p>
                              </>,
                              { okLabel: t.fpOk }
                            )
                            if (ok)
                              await run(
                                async () => {
                                  await api.teamAddMember(team.id, u, preview.fingerprint)
                                  await loadMembers(team.id)
                                },
                                fmt(t.memberAdded, preview.username)
                              )
                          }}
                        >
                          {t.addMember}
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
  const t = useT(S)
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

  if (!status) return <div className="view muted">{t.loading}</div>

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
            {status.syncing ? t.syncing : t.syncNow}
          </button>
        )}
      </div>

      {!status.connected ? (
        <>
          <p className="view-intro">{t.intro}</p>
          <Connect onDone={() => void refresh()} />
        </>
      ) : (
        <>
          <table className="table" style={{ maxWidth: 640 }}>
            <tbody>
              <tr>
                <td className="muted">{t.server}</td>
                <td className="mono small">{status.serverUrl}</td>
              </tr>
              <tr>
                <td className="muted">{t.account}</td>
                <td>
                  {status.username}
                  {status.isAdmin ? <span className="muted">{t.serverAdmin}</span> : null}
                </td>
              </tr>
              <tr>
                <td className="muted">{t.yourFp}</td>
                <td>
                  <span className="fp">{status.fingerprint}</span>
                  <div className="muted small">{t.fpHint}</div>
                </td>
              </tr>
              <tr>
                <td className="muted">{t.lastSync}</td>
                <td>{status.lastSyncAt ? timeAgo(status.lastSyncAt) : t.never}</td>
              </tr>
              {status.lastError && (
                <tr>
                  <td className="muted">{t.lastError}</td>
                  <td style={{ color: 'var(--danger)' }}>{status.lastError}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small">{t.notSyncedNote}</p>

          <Teams status={status} />

          <h2 className="section-title">{t.devices}</h2>
          {devices === null ? (
            <p className="muted">{t.devicesLoadFail}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t.thName}</th>
                  <th>{t.thLastActive}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      {d.current ? <span className="muted">{t.thisDevice}</span> : null}
                    </td>
                    <td className="muted">{timeAgo(d.lastSeen)}</td>
                    <td className="actions">
                      {!d.current && (
                        <button
                          className="btn sm ghost danger"
                          onClick={async () => {
                            if (
                              !(await confirmDialog(
                                t.revokeDevice,
                                fmt(t.revokeDeviceMsg, d.name),
                                { danger: true, okLabel: t.revoke }
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
                          {t.revoke}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {status.isAdmin && <SyncAdmin />}

          <h2 className="section-title">{t.account}</h2>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                const r = await promptDialog(
                  t.changePwTitle,
                  [
                    { key: 'old', label: t.oldPw, type: 'password' },
                    { key: 'a', label: t.newPw, type: 'password' },
                    { key: 'b', label: t.newPw2, type: 'password' }
                  ],
                  t.change
                )
                if (!r) return
                if (r.a.length < 10 || r.a !== r.b) return toast(t.invalidNewPw, 'error')
                try {
                  await api.syncChangePassword(r.old, r.a)
                  toast(t.pwChanged)
                  await refresh()
                } catch (e) {
                  toast(errMsg(e), 'error')
                }
              }}
            >
              {t.changePwBtn}
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                const ok = await confirmDialog(t.logoutTitle, t.logoutMsg, {
                  okLabel: t.leave
                })
                if (ok) {
                  await api.syncLogout()
                  await refresh()
                }
              }}
            >
              {t.logoutSync}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
