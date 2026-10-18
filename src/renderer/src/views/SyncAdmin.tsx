import { useCallback, useEffect, useState } from 'react'
import type { AdminInvite, AdminOverview, SignupMode } from '../../../shared/api'
import { api, errMsg } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { confirmDialog, formatBytes, promptDialog, timeAgo } from '../lib'

const S = {
  id: {
    title: 'Admin server',
    intro:
      'Kelola siapa yang boleh memakai server ini. Admin tidak bisa membaca isi vault siapa pun; yang terlihat hanya metadata.',
    loading: 'Memuat',
    signup: 'Pendaftaran',
    followEnv: 'Ikuti konfigurasi server (TERMOS_SIGNUP=%s)',
    modeOpen: 'Terbuka: siapa pun yang bisa mengakses server boleh daftar',
    modeInvite: 'Undangan: daftar butuh kode undangan',
    modeClosed: 'Ditutup: tidak ada pendaftaran, termasuk lewat undangan',
    nowEffective: 'Berlaku sekarang: %s',
    effOpen: 'terbuka',
    effInvite: 'butuh undangan',
    effClosed: 'ditutup',
    signupSaved: 'Pengaturan pendaftaran disimpan',
    invites: 'Undangan',
    newInvite: 'Buat undangan',
    inviteHours: 'Berlaku (jam, 1-720)',
    inviteNote: 'Catatan (mis. untuk siapa)',
    create: 'Buat',
    invalidHours: 'Masa berlaku harus 1-720 jam',
    codeTitle: 'Kode undangan',
    codeIntro:
      'Kirim kode ini ke orang yang diundang. Kode hanya ditampilkan sekali dan hanya bisa dipakai untuk satu akun.',
    codeExpires: 'Berlaku sampai %s.',
    copy: 'Salin',
    copied: 'Kode disalin',
    done: 'Selesai',
    noInvites: 'Belum ada undangan.',
    thNote: 'Catatan',
    thStatus: 'Status',
    thBy: 'Dibuat oleh',
    active: 'aktif, sampai %s',
    usedBy: 'dipakai oleh %s',
    expired: 'kedaluwarsa',
    revokeInvite: 'Batalkan',
    inviteRevoked: 'Undangan dibatalkan',
    users: 'Pengguna (%s)',
    thUser: 'Username',
    thJoined: 'Terdaftar',
    thDevices: 'Perangkat',
    thLastActive: 'Terakhir aktif',
    thVault: 'Vault pribadi',
    records: '%s item · %s',
    you: 'kamu',
    admin: 'admin',
    never: 'belum pernah',
    makeAdmin: 'Jadikan admin',
    makeAdminMsg:
      'Jadikan %s admin server? Admin bisa membuat undangan, mengeluarkan dan menghapus pengguna.',
    unAdmin: 'Cabut admin',
    unAdminMsg: 'Cabut hak admin dari %s?',
    adminChanged: 'Hak admin %s diubah',
    signOut: 'Keluarkan dari semua perangkat',
    signOutShort: 'Logout paksa',
    signOutMsg: 'Semua perangkat %s harus login lagi. Data vault-nya tidak terhapus.',
    signedOut: '%s dikeluarkan dari semua perangkat',
    deleteUser: 'Hapus akun',
    deleteUserMsg:
      'Hapus akun %s beserta vault pribadinya dan semua tim yang ia miliki? Tidak bisa dibatalkan; item yang sudah tersalin di perangkat lain tetap ada di sana.',
    userDeleted: 'Akun %s dihapus',
    quota: 'Kuota per vault: %s item, %s.'
  },
  en: {
    title: 'Server admin',
    intro:
      "Manage who may use this server. Admins cannot read anyone's vault contents; only metadata is visible.",
    loading: 'Loading',
    signup: 'Sign-up',
    followEnv: 'Follow the server configuration (TERMOS_SIGNUP=%s)',
    modeOpen: 'Open: anyone who can reach the server may register',
    modeInvite: 'Invite: registering needs an invite code',
    modeClosed: 'Closed: no registration at all, invites included',
    nowEffective: 'In effect now: %s',
    effOpen: 'open',
    effInvite: 'invite required',
    effClosed: 'closed',
    signupSaved: 'Sign-up setting saved',
    invites: 'Invites',
    newInvite: 'Create invite',
    inviteHours: 'Valid for (hours, 1-720)',
    inviteNote: 'Note (e.g. who it is for)',
    create: 'Create',
    invalidHours: 'Validity must be 1-720 hours',
    codeTitle: 'Invite code',
    codeIntro:
      'Send this code to the person you invite. It is shown only once and works for a single account.',
    codeExpires: 'Valid until %s.',
    copy: 'Copy',
    copied: 'Code copied',
    done: 'Done',
    noInvites: 'No invites yet.',
    thNote: 'Note',
    thStatus: 'Status',
    thBy: 'Created by',
    active: 'active, until %s',
    usedBy: 'used by %s',
    expired: 'expired',
    revokeInvite: 'Revoke',
    inviteRevoked: 'Invite revoked',
    users: 'Users (%s)',
    thUser: 'Username',
    thJoined: 'Joined',
    thDevices: 'Devices',
    thLastActive: 'Last active',
    thVault: 'Personal vault',
    records: '%s items · %s',
    you: 'you',
    admin: 'admin',
    never: 'never',
    makeAdmin: 'Make admin',
    makeAdminMsg: 'Make %s a server admin? Admins can create invites and sign out or delete users.',
    unAdmin: 'Remove admin',
    unAdminMsg: 'Remove admin rights from %s?',
    adminChanged: 'Admin rights of %s changed',
    signOut: 'Sign out of all devices',
    signOutShort: 'Force logout',
    signOutMsg: 'All devices of %s will have to log in again. Their vault data is not deleted.',
    signedOut: '%s signed out of all devices',
    deleteUser: 'Delete account',
    deleteUserMsg:
      'Delete the account %s with its personal vault and every team it owns? This cannot be undone; items already copied to other devices stay there.',
    userDeleted: 'Account %s deleted',
    quota: 'Quota per vault: %s items, %s.'
  }
}

const date = (ms: number): string => new Date(ms).toLocaleString()

/** Admin section of the Sync view; only rendered for server admins. */
export function SyncAdmin(): React.JSX.Element {
  const t = useT(S)
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.adminOverview())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn()
      if (ok) toast(ok)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
    await load()
  }

  const inviteStatus = (i: AdminInvite): string =>
    i.usedAt
      ? fmt(t.usedBy, i.usedBy ?? '?')
      : i.expiresAt < Date.now()
        ? t.expired
        : fmt(t.active, date(i.expiresAt))

  if (error && !data)
    return (
      <>
        <h2 className="section-title">{t.title}</h2>
        <div className="alert error small">{error}</div>
      </>
    )
  if (!data)
    return (
      <>
        <h2 className="section-title">{t.title}</h2>
        <p className="muted">{t.loading}</p>
      </>
    )

  const effective = { open: t.effOpen, invite: t.effInvite, closed: t.effClosed }[data.signup]

  return (
    <>
      <h2 className="section-title">{t.title}</h2>
      <p className="view-intro">{t.intro}</p>

      <div className="field" style={{ maxWidth: 560 }}>
        <label htmlFor="admin-signup">{t.signup}</label>
        <select
          id="admin-signup"
          className="select"
          value={data.signupSetting ?? ''}
          onChange={(e) => {
            const mode = (e.target.value || null) as SignupMode | null
            void run(() => api.adminSetSignup(mode), t.signupSaved)
          }}
        >
          <option value="">{fmt(t.followEnv, data.envSignup)}</option>
          <option value="open">{t.modeOpen}</option>
          <option value="invite">{t.modeInvite}</option>
          <option value="closed">{t.modeClosed}</option>
        </select>
        <div className="hint">
          {fmt(t.nowEffective, effective)}.{' '}
          {fmt(t.quota, String(data.maxRecords), formatBytes(data.maxBytes))}
        </div>
      </div>

      <div className="row">
        <h2 className="section-title grow">{t.invites}</h2>
        <button
          className="btn sm"
          onClick={async () => {
            const r = await promptDialog(
              t.newInvite,
              [
                { key: 'hours', label: t.inviteHours, value: '72' },
                { key: 'note', label: t.inviteNote }
              ],
              t.create
            )
            if (!r) return
            const hours = Number(r.hours)
            if (!Number.isInteger(hours) || hours < 1 || hours > 720)
              return toast(t.invalidHours, 'error')
            await run(async () => setCode(await api.adminCreateInvite(hours, r.note.trim())))
          }}
        >
          {t.newInvite}
        </button>
      </div>
      {data.invites.length === 0 ? (
        <p className="muted">{t.noInvites}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.thNote}</th>
              <th>{t.thStatus}</th>
              <th>{t.thBy}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.invites.map((i) => (
              <tr key={i.id}>
                <td>{i.note || <span className="muted">-</span>}</td>
                <td className="muted">{inviteStatus(i)}</td>
                <td className="muted">{i.createdBy ?? '-'}</td>
                <td className="actions">
                  {!i.usedAt && i.expiresAt > Date.now() && (
                    <button
                      className="btn sm ghost danger"
                      onClick={() => void run(() => api.adminRevokeInvite(i.id), t.inviteRevoked)}
                    >
                      {t.revokeInvite}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title">{fmt(t.users, String(data.users.length))}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>{t.thUser}</th>
            <th>{t.thJoined}</th>
            <th>{t.thDevices}</th>
            <th>{t.thLastActive}</th>
            <th>{t.thVault}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id}>
              <td>
                <span className="cell-title">{u.username}</span>{' '}
                {u.isAdmin && <span className="tag">{t.admin}</span>}{' '}
                {u.current && <span className="muted small">({t.you})</span>}
              </td>
              <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td className="muted">{u.devices}</td>
              <td className="muted">{u.lastSeen ? timeAgo(u.lastSeen) : t.never}</td>
              <td className="muted">{fmt(t.records, String(u.records), formatBytes(u.bytes))}</td>
              <td className="actions">
                {!u.current && (
                  <>
                    <button
                      className="btn sm ghost"
                      onClick={async () => {
                        const on = !u.isAdmin
                        const ok = await confirmDialog(
                          on ? t.makeAdmin : t.unAdmin,
                          fmt(on ? t.makeAdminMsg : t.unAdminMsg, u.username)
                        )
                        if (ok)
                          await run(
                            () => api.adminSetAdmin(u.id, on),
                            fmt(t.adminChanged, u.username)
                          )
                      }}
                    >
                      {u.isAdmin ? t.unAdmin : t.makeAdmin}
                    </button>
                    <button
                      className="btn sm ghost"
                      title={t.signOut}
                      disabled={u.devices === 0}
                      onClick={async () => {
                        const ok = await confirmDialog(t.signOut, fmt(t.signOutMsg, u.username), {
                          danger: true,
                          okLabel: t.signOutShort
                        })
                        if (ok)
                          await run(
                            () => api.adminRevokeDevices(u.id),
                            fmt(t.signedOut, u.username)
                          )
                      }}
                    >
                      {t.signOutShort}
                    </button>
                    <button
                      className="btn sm ghost danger"
                      onClick={async () => {
                        const ok = await confirmDialog(
                          t.deleteUser,
                          fmt(t.deleteUserMsg, u.username),
                          { danger: true, okLabel: t.deleteUser }
                        )
                        if (ok)
                          await run(() => api.adminDeleteUser(u.id), fmt(t.userDeleted, u.username))
                      }}
                    >
                      {t.deleteUser}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {code && (
        <Modal
          title={t.codeTitle}
          onClose={() => setCode(null)}
          footer={
            <button className="btn primary" onClick={() => setCode(null)}>
              {t.done}
            </button>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {t.codeIntro}
          </p>
          <div className="row" style={{ marginBottom: 8 }}>
            <input
              className="input mono"
              readOnly
              value={code.code}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(code.code)
                toast(t.copied)
              }}
            >
              {t.copy}
            </button>
          </div>
          <p className="small muted">{fmt(t.codeExpires, date(code.expiresAt))}</p>
        </Modal>
      )}
    </>
  )
}
