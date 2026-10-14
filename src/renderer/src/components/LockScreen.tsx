import { useState } from 'react'
import { api, errMsg } from '../api'
import { useT } from '../i18n'
import { useStore } from '../store'

const S = {
  id: {
    title: 'Termos',
    createIntro:
      'Buat master password. Semua host, key, dan password disimpan terenkripsi dengan password ini.',
    unlockIntro: 'Masukkan master password untuk membuka vault.',
    password: 'Master password',
    confirm: 'Ulangi master password',
    minLen: 'Master password minimal 8 karakter',
    mismatch: 'Konfirmasi password tidak sama',
    busy: 'Memproses…',
    create: 'Buat vault',
    unlock: 'Buka',
    keychain: 'Buka dengan keychain sistem',
    unrecoverable: 'Password ini tidak bisa dipulihkan. Kalau lupa, isi vault tidak bisa dibuka.'
  },
  en: {
    title: 'Termos',
    createIntro:
      'Create a master password. All hosts, keys and passwords are stored encrypted with this password.',
    unlockIntro: 'Enter the master password to unlock the vault.',
    password: 'Master password',
    confirm: 'Repeat master password',
    minLen: 'Master password must be at least 8 characters',
    mismatch: 'Passwords do not match',
    busy: 'Working…',
    create: 'Create vault',
    unlock: 'Unlock',
    keychain: 'Unlock with the system keychain',
    unrecoverable:
      'This password cannot be recovered. If you forget it, the vault contents are lost.'
  }
}

export function LockScreen(): React.JSX.Element {
  const t = useT(S)
  const status = useStore((s) => s.status)!
  const refresh = useStore((s) => s.refreshStatus)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = !status.exists

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (creating) {
      if (pw.length < 8) return setError(t.minLen)
      if (pw !== pw2) return setError(t.mismatch)
    }
    setBusy(true)
    try {
      if (creating) await api.vaultCreate(pw)
      else await api.vaultUnlock(pw)
      await refresh()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const quick = async (): Promise<void> => {
    setError(null)
    try {
      await api.vaultQuickUnlock()
      await refresh()
    } catch (err) {
      setError(errMsg(err))
    }
  }

  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <h1>{t.title}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {creating ? t.createIntro : t.unlockIntro}
        </p>
        <div className="field">
          <input
            className="input"
            type="password"
            autoFocus
            placeholder={t.password}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {creating && (
          <div className="field">
            <input
              className="input"
              type="password"
              placeholder={t.confirm}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </div>
        )}
        {error && <div className="alert error small">{error}</div>}
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={busy}
        >
          {busy ? t.busy : creating ? t.create : t.unlock}
        </button>
        {!creating && status.quickUnlock && (
          <button
            type="button"
            className="btn ghost"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            onClick={quick}
          >
            {t.keychain}
          </button>
        )}
        {creating && (
          <p className="dim small" style={{ marginTop: 14, marginBottom: 0 }}>
            {t.unrecoverable}
          </p>
        )}
      </form>
    </div>
  )
}
