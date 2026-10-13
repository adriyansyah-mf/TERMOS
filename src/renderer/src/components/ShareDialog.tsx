import { useEffect, useState } from 'react'
import type { ShareInfo } from '../../../shared/api'
import { api, bridge, errMsg } from '../api'
import { useStore } from '../store'
import { Check, Modal } from './ui'

/** Start, watch and stop live sharing of one terminal session. */
export function ShareDialog(props: {
  sessionId: string
  label: string
  onClose(): void
}): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const [share, setShare] = useState<ShareInfo | null>(null)
  const [allowInput, setAllowInput] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .shareList()
      .then((l) => setShare(l.find((s) => s.sessionId === props.sessionId) ?? null))
    return bridge.on('share:status', (l) =>
      setShare(l.find((s) => s.sessionId === props.sessionId) ?? null)
    )
  }, [props.sessionId])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setShare(await api.shareStart(props.sessionId, allowInput))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Bagikan sesi ${props.label}`}
      onClose={props.onClose}
      footer={
        share ? (
          <>
            <button className="btn danger" onClick={() => void api.shareStop(props.sessionId)}>
              Hentikan berbagi
            </button>
            <button className="btn" onClick={props.onClose}>
              Tutup
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={props.onClose}>
              Batal
            </button>
            <button className="btn primary" disabled={busy} onClick={start}>
              {busy ? 'Menghubungkan' : 'Mulai berbagi'}
            </button>
          </>
        )
      }
    >
      {!share ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Orang lain di server sync yang sama bisa menonton terminal ini secara langsung lewat
            link. Isi terminal dienkripsi dengan kunci yang hanya ada di link; server tidak bisa
            membacanya.
          </p>
          <Check
            label="Izinkan penonton mengetik di terminal ini"
            checked={allowInput}
            onChange={setAllowInput}
          />
          {error && <div className="alert error small">{error}</div>}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Kirim link ini ke rekan. Mereka membukanya lewat Hosts, Gabung sesi bersama.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input mono small"
              readOnly
              value={share.link}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(share.link)
                toast('Link disalin')
              }}
            >
              Salin
            </button>
          </div>
          <Check
            label="Izinkan penonton mengetik"
            checked={share.allowInput}
            onChange={(v) => void api.shareSetInput(props.sessionId, v)}
          />
          <h2 className="section-title">Penonton ({share.viewers.length})</h2>
          {share.viewers.length === 0 ? (
            <p className="muted">Belum ada yang bergabung.</p>
          ) : (
            <table className="simple">
              <tbody>
                {share.viewers.map((v) => (
                  <tr key={v.id}>
                    <td>{v.username}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn sm ghost danger"
                        onClick={() => void api.shareKick(props.sessionId, v.id)}
                      >
                        Keluarkan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  )
}
