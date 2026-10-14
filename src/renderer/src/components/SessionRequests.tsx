import { useState } from 'react'
import { useT } from '../i18n'
import { useStore, type PendingRequest } from '../store'
import { Modal } from './ui'

const S = {
  id: {
    hostKeyChanged: 'Host key berubah',
    newHost: 'Host baru',
    reject: 'Tolak',
    replace: 'Ganti & lanjutkan',
    trust: 'Percayai & lanjutkan',
    changed:
      'Fingerprint host ini berbeda dari yang tersimpan. Bisa jadi server diinstal ulang, atau ada yang menyadap koneksi (MITM). Jangan lanjutkan kalau tidak yakin.',
    unknown:
      'Termos belum pernah terhubung ke host ini. Cocokkan fingerprint-nya sebelum melanjutkan.',
    cancel: 'Batal',
    send: 'Kirim'
  },
  en: {
    hostKeyChanged: 'Host key changed',
    newHost: 'New host',
    reject: 'Reject',
    replace: 'Replace & continue',
    trust: 'Trust & continue',
    changed:
      "This host's fingerprint differs from the stored one. The server may have been reinstalled, or the connection is being intercepted (MITM). Do not continue if you are unsure.",
    unknown: 'Termos has never connected to this host. Verify the fingerprint before continuing.',
    cancel: 'Cancel',
    send: 'Send'
  }
}

function HostKey({ r }: { r: Extract<PendingRequest, { type: 'hostkey' }> }): React.JSX.Element {
  const t = useT(S)
  const answer = useStore((s) => s.answer)
  return (
    <Modal
      title={r.changed ? t.hostKeyChanged : t.newHost}
      onClose={() => answer(r.requestId, false)}
      footer={
        <>
          <button className="btn" onClick={() => answer(r.requestId, false)}>
            {t.reject}
          </button>
          <button
            className={'btn ' + (r.changed ? 'danger' : 'primary')}
            onClick={() => answer(r.requestId, true)}
          >
            {r.changed ? t.replace : t.trust}
          </button>
        </>
      }
    >
      {r.changed ? (
        <div className="alert error small">{t.changed}</div>
      ) : (
        <p className="muted">{t.unknown}</p>
      )}
      <p className="small muted" style={{ marginBottom: 4 }}>
        {r.host}:{r.port} · {r.keyType}
      </p>
      <div className="fp">{r.fingerprint}</div>
    </Modal>
  )
}

function Prompt({ r }: { r: Extract<PendingRequest, { type: 'prompt' }> }): React.JSX.Element {
  const t = useT(S)
  const answer = useStore((s) => s.answer)
  const [values, setValues] = useState<string[]>(r.prompts.map(() => ''))
  const submit = (): void => answer(r.requestId, values)
  return (
    <Modal
      title={r.title}
      onClose={() => answer(r.requestId, null)}
      footer={
        <>
          <button className="btn" onClick={() => answer(r.requestId, null)}>
            {t.cancel}
          </button>
          <button className="btn primary" onClick={submit}>
            {t.send}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {r.prompts.map((p, i) => (
          <div className="field" key={i}>
            <label>{p.prompt}</label>
            <input
              className="input"
              autoFocus={i === 0}
              type={p.echo ? 'text' : 'password'}
              value={values[i]}
              onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function SessionRequests(): React.JSX.Element | null {
  const r = useStore((s) => s.requests[0])
  if (!r) return null
  return r.type === 'hostkey' ? (
    <HostKey key={r.requestId} r={r} />
  ) : (
    <Prompt key={r.requestId} r={r} />
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
