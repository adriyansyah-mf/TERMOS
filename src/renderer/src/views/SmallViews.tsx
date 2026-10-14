import { useEffect, useMemo, useState } from 'react'
import type { Language } from '../../../shared/types'
import { api, errMsg } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { THEMES } from '../themes'
import { Check, Field } from '../components/ui'
import { confirmDialog, promptDialog } from '../lib'

const knownHostsS = {
  id: {
    title: 'Known hosts',
    search: 'Cari host atau fingerprint',
    searchLabel: 'Cari known host',
    intro:
      'Fingerprint server yang sudah kamu percayai. Hapus entri kalau server memang diinstal ulang; Termos akan bertanya lagi saat konek berikutnya.',
    noMatch: 'Tidak ada yang cocok dengan "%s".',
    empty: 'Belum ada. Fingerprint tercatat otomatis saat kamu menyetujuinya ketika pertama konek.',
    host: 'Host',
    keyType: 'Tipe key',
    fingerprint: 'Fingerprint',
    remove: 'Hapus'
  },
  en: {
    title: 'Known hosts',
    search: 'Search host or fingerprint',
    searchLabel: 'Search known host',
    intro:
      'Fingerprints of servers you have trusted. Remove an entry if the server really was reinstalled; Termos will ask again on the next connection.',
    noMatch: 'Nothing matches "%s".',
    empty:
      'Nothing yet. Fingerprints are recorded automatically when you approve them on first connect.',
    host: 'Host',
    keyType: 'Key type',
    fingerprint: 'Fingerprint',
    remove: 'Remove'
  }
}

export function KnownHostsView(): React.JSX.Element {
  const t = useT(knownHostsS)
  const known = useStore((s) => s.data?.knownHosts ?? [])
  const [q, setQ] = useState('')
  const list = known.filter((k) => !q || k.host.includes(q) || k.fingerprint.includes(q))
  return (
    <div className="view">
      <div className="view-head">
        <h1>{t.title}</h1>
        <span className="grow" />
        <input
          className="input search"
          placeholder={t.search}
          aria-label={t.searchLabel}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="view-intro">{t.intro}</p>
      {list.length === 0 ? (
        <div className="empty">
          <p>{q ? fmt(t.noMatch, q) : t.empty}</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.host}</th>
              <th>{t.keyType}</th>
              <th>{t.fingerprint}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((k) => (
              <tr key={k.id}>
                <td className="mono">
                  {k.host}:{k.port}
                </td>
                <td className="muted">{k.keyType}</td>
                <td className="fp">{k.fingerprint}</td>
                <td className="actions">
                  <button
                    className="btn sm ghost danger"
                    onClick={() => void api.remove('knownHosts', k.id)}
                  >
                    {t.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const historyS = {
  id: {
    title: 'Riwayat perintah',
    filterHost: 'Filter host',
    allHosts: 'Semua host',
    search: 'Cari perintah',
    searchLabel: 'Cari perintah',
    off: 'Pencatatan riwayat sedang mati. Nyalakan di Settings.',
    noMatch: 'Tidak ada perintah yang cocok dengan filter ini.',
    empty:
      'Belum ada riwayat. Perintah yang kamu ketik di sesi host tersimpan di sini (kecuali saat diminta password).',
    command: 'Perintah',
    host: 'Host',
    time: 'Waktu',
    copied: 'Disalin',
    copy: 'Salin'
  },
  en: {
    title: 'Command history',
    filterHost: 'Filter host',
    allHosts: 'All hosts',
    search: 'Search command',
    searchLabel: 'Search command',
    off: 'History recording is off. Enable it in Settings.',
    noMatch: 'No commands match this filter.',
    empty:
      'No history yet. Commands you type in host sessions are stored here (except when a password is asked).',
    command: 'Command',
    host: 'Host',
    time: 'Time',
    copied: 'Copied',
    copy: 'Copy'
  }
}

export function HistoryView(): React.JSX.Element {
  const t = useT(historyS)
  const data = useStore((s) => s.data)!
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState('')
  const [hostId, setHostId] = useState('')
  const list = useMemo(
    () =>
      data.history
        .filter(
          (h) =>
            (!hostId || h.hostId === hostId) &&
            (!q || h.command.toLowerCase().includes(q.toLowerCase()))
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, 500),
    [data.history, q, hostId]
  )
  return (
    <div className="view">
      <div className="view-head">
        <h1>{t.title}</h1>
        <span className="grow" />
        <select
          className="select"
          style={{ width: 180 }}
          aria-label={t.filterHost}
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
        >
          <option value="">{t.allHosts}</option>
          {data.hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        <input
          className="input search"
          placeholder={t.search}
          aria-label={t.searchLabel}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!data.settings.recordHistory && <div className="alert small">{t.off}</div>}
      {list.length === 0 ? (
        <div className="empty">
          <p>{q || hostId ? t.noMatch : t.empty}</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.command}</th>
              <th>{t.host}</th>
              <th>{t.time}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id}>
                <td className="mono small" style={{ userSelect: 'text' }}>
                  {h.command}
                </td>
                <td className="muted">{data.hosts.find((x) => x.id === h.hostId)?.label}</td>
                <td className="muted small">{new Date(h.at).toLocaleString()}</td>
                <td className="actions">
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(h.command)
                      toast(t.copied)
                    }}
                  >
                    {t.copy}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const settingsS = {
  id: {
    title: 'Settings',
    general: 'Umum',
    language: 'Bahasa',
    terminal: 'Terminal',
    theme: 'Tema',
    fontSize: 'Ukuran font',
    font: 'Font',
    scrollback: 'Scrollback (baris)',
    scrollbackHint: 'Berlaku untuk tab yang dibuka setelah ini.',
    cursorBlink: 'Kursor berkedip',
    recordHistory: 'Catat riwayat perintah per host',
    security: 'Keamanan',
    autoLock: 'Kunci otomatis setelah tidak dipakai',
    autoLockHint: 'Semua sesi ditutup saat vault terkunci.',
    min5: '5 menit',
    min15: '15 menit',
    min30: '30 menit',
    hour1: '1 jam',
    hours4: '4 jam',
    never: 'Jangan kunci otomatis',
    lockOnSleep: 'Kunci saat komputer tidur atau layar dikunci',
    quickUnlock: 'Buka vault dengan keychain sistem (tanpa ketik master password)',
    changePw: 'Ganti master password',
    changePwTitle: 'Ganti master password',
    oldPw: 'Password lama',
    newPw: 'Password baru (min. 8 karakter)',
    repeatPw: 'Ulangi password baru',
    change: 'Ganti',
    pwInvalid: 'Password baru tidak valid atau tidak sama',
    pwChanged: 'Master password diganti',
    lockNowTitle: 'Kunci vault',
    lockNowBody: 'Semua sesi terminal akan ditutup.',
    lock: 'Kunci',
    lockNow: 'Kunci sekarang',
    about: 'Tentang',
    aboutBody:
      'Termos %s · data vault: terenkripsi Argon2id + XChaCha20-Poly1305 di folder data aplikasi.',
    shortcuts: 'Pintasan:',
    scQuickConnect: 'quick connect',
    scLocal: 'terminal lokal',
    scCloseTab: 'tutup tab',
    scSwitchTab: 'pindah tab',
    scCopyPaste: 'salin/tempel'
  },
  en: {
    title: 'Settings',
    general: 'General',
    language: 'Language',
    terminal: 'Terminal',
    theme: 'Theme',
    fontSize: 'Font size',
    font: 'Font',
    scrollback: 'Scrollback (lines)',
    scrollbackHint: 'Applies to tabs opened after this.',
    cursorBlink: 'Blinking cursor',
    recordHistory: 'Record command history per host',
    security: 'Security',
    autoLock: 'Lock automatically after inactivity',
    autoLockHint: 'All sessions are closed when the vault locks.',
    min5: '5 minutes',
    min15: '15 minutes',
    min30: '30 minutes',
    hour1: '1 hour',
    hours4: '4 hours',
    never: 'Never lock automatically',
    lockOnSleep: 'Lock when the computer sleeps or the screen is locked',
    quickUnlock: 'Unlock the vault with the system keychain (no master password)',
    changePw: 'Change master password',
    changePwTitle: 'Change master password',
    oldPw: 'Old password',
    newPw: 'New password (min. 8 characters)',
    repeatPw: 'Repeat new password',
    change: 'Change',
    pwInvalid: 'New password is invalid or does not match',
    pwChanged: 'Master password changed',
    lockNowTitle: 'Lock vault',
    lockNowBody: 'All terminal sessions will be closed.',
    lock: 'Lock',
    lockNow: 'Lock now',
    about: 'About',
    aboutBody:
      'Termos %s · vault data: encrypted with Argon2id + XChaCha20-Poly1305 in the app data folder.',
    shortcuts: 'Shortcuts:',
    scQuickConnect: 'quick connect',
    scLocal: 'local terminal',
    scCloseTab: 'close tab',
    scSwitchTab: 'switch tab',
    scCopyPaste: 'copy/paste'
  }
}

export function SettingsView(): React.JSX.Element {
  const t = useT(settingsS)
  const settings = useStore((s) => s.data!.settings)
  const status = useStore((s) => s.status)
  const { toast, refreshStatus } = useStore.getState()
  const [version, setVersion] = useState('')
  useEffect(() => void api.appVersion().then(setVersion), [])
  const set = (patch: Partial<typeof settings>): void => void api.updateSettings(patch)

  return (
    <div className="view" style={{ maxWidth: 720 }}>
      <div className="view-head">
        <h1>{t.title}</h1>
      </div>

      <div className="section-title">{t.general}</div>
      <Field label={t.language}>
        <select
          className="select"
          style={{ maxWidth: 240 }}
          value={settings.language}
          onChange={(e) => set({ language: e.target.value as Language })}
        >
          <option value="id">Bahasa Indonesia</option>
          <option value="en">English</option>
        </select>
      </Field>

      <div className="section-title">{t.terminal}</div>
      <div className="grid-2">
        <Field label={t.theme}>
          <select
            className="select"
            value={settings.theme}
            onChange={(e) => set({ theme: e.target.value })}
          >
            {Object.entries(THEMES).map(([k, th]) => (
              <option key={k} value={k}>
                {th.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.fontSize}>
          <input
            className="input"
            type="number"
            min={8}
            max={32}
            value={settings.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) || 14 })}
          />
        </Field>
      </div>
      <Field label={t.font}>
        <input
          className="input mono"
          value={settings.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
        />
      </Field>
      <Field label={t.scrollback} hint={t.scrollbackHint}>
        <input
          className="input"
          type="number"
          value={settings.scrollback}
          onChange={(e) => set({ scrollback: Number(e.target.value) || 1000 })}
        />
      </Field>
      <Check
        label={t.cursorBlink}
        checked={settings.cursorBlink}
        onChange={(v) => set({ cursorBlink: v })}
      />
      <Check
        label={t.recordHistory}
        checked={settings.recordHistory}
        onChange={(v) => set({ recordHistory: v })}
      />

      <div className="section-title">{t.security}</div>
      <Field label={t.autoLock} hint={t.autoLockHint}>
        <select
          className="select"
          style={{ maxWidth: 240 }}
          value={settings.autoLockMinutes}
          onChange={(e) => set({ autoLockMinutes: Number(e.target.value) })}
        >
          <option value={5}>{t.min5}</option>
          <option value={15}>{t.min15}</option>
          <option value={30}>{t.min30}</option>
          <option value={60}>{t.hour1}</option>
          <option value={240}>{t.hours4}</option>
          <option value={0}>{t.never}</option>
        </select>
      </Field>
      <Check
        label={t.lockOnSleep}
        checked={settings.lockOnSleep}
        onChange={(v) => set({ lockOnSleep: v })}
      />
      <Check
        label={t.quickUnlock}
        checked={!!status?.quickUnlock}
        onChange={async (v) => {
          try {
            await api.vaultSetQuickUnlock(v)
            await refreshStatus()
          } catch (e) {
            toast(errMsg(e), 'error')
          }
        }}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn"
          onClick={async () => {
            const r = await promptDialog(
              t.changePwTitle,
              [
                { key: 'old', label: t.oldPw, type: 'password' },
                { key: 'a', label: t.newPw, type: 'password' },
                { key: 'b', label: t.repeatPw, type: 'password' }
              ],
              t.change
            )
            if (!r) return
            if (r.a.length < 8 || r.a !== r.b) return toast(t.pwInvalid, 'error')
            try {
              await api.vaultChangePassword(r.old, r.a)
              toast(t.pwChanged)
            } catch (e) {
              toast(errMsg(e), 'error')
            }
          }}
        >
          {t.changePw}
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (
              await confirmDialog(t.lockNowTitle, t.lockNowBody, {
                okLabel: t.lock
              })
            ) {
              await api.vaultLock()
              await refreshStatus()
            }
          }}
        >
          {t.lockNow}
        </button>
      </div>

      <div className="section-title">{t.about}</div>
      <p className="muted small">{fmt(t.aboutBody, version)}</p>
      <p className="dim small">
        {t.shortcuts} <kbd>Ctrl</kbd>+<kbd>K</kbd> {t.scQuickConnect} · <kbd>Ctrl</kbd>+
        <kbd>Shift</kbd>+<kbd>T</kbd> {t.scLocal} · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd>{' '}
        {t.scCloseTab} · <kbd>Ctrl</kbd>+<kbd>Tab</kbd> {t.scSwitchTab} · <kbd>Ctrl</kbd>+
        <kbd>Shift</kbd>+<kbd>C</kbd>/<kbd>V</kbd> {t.scCopyPaste}
      </p>
    </div>
  )
}
