import { useEffect, useMemo, useState } from 'react'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { THEMES } from '../themes'
import { Check, Field } from '../components/ui'
import { confirmDialog, promptDialog } from '../lib'

export function KnownHostsView(): React.JSX.Element {
  const known = useStore((s) => s.data?.knownHosts ?? [])
  const [q, setQ] = useState('')
  const list = known.filter((k) => !q || k.host.includes(q) || k.fingerprint.includes(q))
  return (
    <div className="view">
      <div className="view-head">
        <h1>Known Hosts</h1>
        <span className="grow" />
        <input
          className="input search"
          placeholder="Cari host…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>
        Fingerprint server yang sudah kamu percayai. Hapus entri kalau server memang diinstal ulang.
      </p>
      {list.length === 0 ? (
        <div className="dim small">Belum ada.</div>
      ) : (
        <div className="list">
          {list.map((k) => (
            <div key={k.id} className="list-row">
              <div className="grow ellipsis">
                <div className="title">
                  {k.host}:{k.port} <span className="tag">{k.keyType}</span>
                </div>
                <div className="fp dim">{k.fingerprint}</div>
              </div>
              <button className="btn sm danger" onClick={() => void api.remove('knownHosts', k.id)}>
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HistoryView(): React.JSX.Element {
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
        <h1>Riwayat perintah</h1>
        <span className="grow" />
        <select
          className="select"
          style={{ width: 180 }}
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
        >
          <option value="">Semua host</option>
          {data.hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
        <input
          className="input search"
          placeholder="Cari perintah…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!data.settings.recordHistory && (
        <div className="alert info small">Pencatatan riwayat sedang mati (Settings).</div>
      )}
      {list.length === 0 ? (
        <div className="dim small">Belum ada riwayat.</div>
      ) : (
        <div className="list">
          {list.map((h) => (
            <div key={h.id} className="list-row" style={{ padding: '6px 14px' }}>
              <span className="mono small grow ellipsis" style={{ userSelect: 'text' }}>
                {h.command}
              </span>
              <span className="dim small">{data.hosts.find((x) => x.id === h.hostId)?.label}</span>
              <span className="dim small">{new Date(h.at).toLocaleString()}</span>
              <button
                className="btn sm ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(h.command)
                  toast('Disalin')
                }}
              >
                Salin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsView(): React.JSX.Element {
  const settings = useStore((s) => s.data!.settings)
  const status = useStore((s) => s.status)
  const { toast, refreshStatus } = useStore.getState()
  const [version, setVersion] = useState('')
  useEffect(() => void api.appVersion().then(setVersion), [])
  const set = (patch: Partial<typeof settings>): void => void api.updateSettings(patch)

  return (
    <div className="view" style={{ maxWidth: 720 }}>
      <div className="view-head">
        <h1>Settings</h1>
      </div>

      <div className="section-title">Terminal</div>
      <div className="grid-2">
        <Field label="Tema">
          <select
            className="select"
            value={settings.theme}
            onChange={(e) => set({ theme: e.target.value })}
          >
            {Object.entries(THEMES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ukuran font">
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
      <Field label="Font">
        <input
          className="input mono"
          value={settings.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
        />
      </Field>
      <Field label="Scrollback (baris)" hint="Berlaku untuk tab yang dibuka setelah ini.">
        <input
          className="input"
          type="number"
          value={settings.scrollback}
          onChange={(e) => set({ scrollback: Number(e.target.value) || 1000 })}
        />
      </Field>
      <Check
        label="Kursor berkedip"
        checked={settings.cursorBlink}
        onChange={(v) => set({ cursorBlink: v })}
      />
      <Check
        label="Catat riwayat perintah per host"
        checked={settings.recordHistory}
        onChange={(v) => set({ recordHistory: v })}
      />

      <div className="section-title">Keamanan</div>
      <Check
        label="Buka vault dengan keychain sistem (tanpa ketik master password)"
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
              'Ganti master password',
              [
                { key: 'old', label: 'Password lama', type: 'password' },
                { key: 'a', label: 'Password baru (min. 8 karakter)', type: 'password' },
                { key: 'b', label: 'Ulangi password baru', type: 'password' }
              ],
              'Ganti'
            )
            if (!r) return
            if (r.a.length < 8 || r.a !== r.b)
              return toast('Password baru tidak valid atau tidak sama', 'error')
            try {
              await api.vaultChangePassword(r.old, r.a)
              toast('Master password diganti')
            } catch (e) {
              toast(errMsg(e), 'error')
            }
          }}
        >
          Ganti master password
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (
              await confirmDialog('Kunci vault', 'Semua sesi terminal akan ditutup.', {
                okLabel: 'Kunci'
              })
            ) {
              await api.vaultLock()
              await refreshStatus()
            }
          }}
        >
          🔒 Kunci sekarang
        </button>
      </div>

      <div className="section-title">Tentang</div>
      <p className="muted small">
        Termos {version} · data vault: terenkripsi Argon2id + XChaCha20-Poly1305 di folder data
        aplikasi.
      </p>
      <p className="dim small">
        Pintasan: <kbd>Ctrl</kbd>+<kbd>K</kbd> quick connect · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+
        <kbd>T</kbd> terminal lokal · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd> tutup tab ·{' '}
        <kbd>Ctrl</kbd>+<kbd>Tab</kbd> pindah tab · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>/
        <kbd>V</kbd> salin/tempel
      </p>
    </div>
  )
}
