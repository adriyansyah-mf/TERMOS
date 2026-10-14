import { useEffect, useState } from 'react'
import type { ShareInfo } from '../../../shared/api'
import { api, bridge, errMsg } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Check, Modal } from './ui'

const S = {
  id: {
    title: 'Bagikan sesi %s',
    stop: 'Hentikan berbagi',
    close: 'Tutup',
    cancel: 'Batal',
    connecting: 'Menghubungkan',
    start: 'Mulai berbagi',
    intro:
      'Orang lain di server sync yang sama bisa menonton terminal ini secara langsung lewat link. Isi terminal dienkripsi dengan kunci yang hanya ada di link; server tidak bisa membacanya.',
    allowInput: 'Izinkan penonton mengetik di terminal ini',
    sendLink: 'Kirim link ini ke rekan. Mereka membukanya lewat Hosts, Gabung sesi bersama.',
    copied: 'Link disalin',
    copy: 'Salin',
    allowTyping: 'Izinkan penonton mengetik',
    viewers: 'Penonton (%s)',
    noViewers: 'Belum ada yang bergabung.',
    kick: 'Keluarkan'
  },
  en: {
    title: 'Share session %s',
    stop: 'Stop sharing',
    close: 'Close',
    cancel: 'Cancel',
    connecting: 'Connecting',
    start: 'Start sharing',
    intro:
      'Others on the same sync server can watch this terminal live via a link. The terminal contents are encrypted with a key that only exists in the link; the server cannot read it.',
    allowInput: 'Allow viewers to type in this terminal',
    sendLink: 'Send this link to a colleague. They open it via Hosts, Join shared session.',
    copied: 'Link copied',
    copy: 'Copy',
    allowTyping: 'Allow viewers to type',
    viewers: 'Viewers (%s)',
    noViewers: 'No one has joined yet.',
    kick: 'Kick'
  }
}

/** Start, watch and stop live sharing of one terminal session. */
export function ShareDialog(props: {
  sessionId: string
  label: string
  onClose(): void
}): React.JSX.Element {
  const t = useT(S)
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
      title={fmt(t.title, props.label)}
      onClose={props.onClose}
      footer={
        share ? (
          <>
            <button className="btn danger" onClick={() => void api.shareStop(props.sessionId)}>
              {t.stop}
            </button>
            <button className="btn" onClick={props.onClose}>
              {t.close}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={props.onClose}>
              {t.cancel}
            </button>
            <button className="btn primary" disabled={busy} onClick={start}>
              {busy ? t.connecting : t.start}
            </button>
          </>
        )
      }
    >
      {!share ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {t.intro}
          </p>
          <Check label={t.allowInput} checked={allowInput} onChange={setAllowInput} />
          {error && <div className="alert error small">{error}</div>}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {t.sendLink}
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
                toast(t.copied)
              }}
            >
              {t.copy}
            </button>
          </div>
          <Check
            label={t.allowTyping}
            checked={share.allowInput}
            onChange={(v) => void api.shareSetInput(props.sessionId, v)}
          />
          <h2 className="section-title">{fmt(t.viewers, String(share.viewers.length))}</h2>
          {share.viewers.length === 0 ? (
            <p className="muted">{t.noViewers}</p>
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
                        {t.kick}
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
