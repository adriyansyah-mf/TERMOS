import { useState } from 'react'
import { api, errMsg } from '../api'
import { useStore } from '../store'

export function LockScreen(): React.JSX.Element {
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
      if (pw.length < 8) return setError('Master password minimal 8 karakter')
      if (pw !== pw2) return setError('Konfirmasi password tidak sama')
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
        <h1>Termos</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {creating
            ? 'Buat master password. Semua host, key, dan password disimpan terenkripsi dengan password ini.'
            : 'Masukkan master password untuk membuka vault.'}
        </p>
        <div className="field">
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="Master password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {creating && (
          <div className="field">
            <input
              className="input"
              type="password"
              placeholder="Ulangi master password"
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
          {busy ? 'Memproses…' : creating ? 'Buat vault' : 'Buka'}
        </button>
        {!creating && status.quickUnlock && (
          <button
            type="button"
            className="btn ghost"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            onClick={quick}
          >
            Buka dengan keychain sistem
          </button>
        )}
        {creating && (
          <p className="dim small" style={{ marginTop: 14, marginBottom: 0 }}>
            Password ini tidak bisa dipulihkan. Kalau lupa, isi vault tidak bisa dibuka.
          </p>
        )}
      </form>
    </div>
  )
}
