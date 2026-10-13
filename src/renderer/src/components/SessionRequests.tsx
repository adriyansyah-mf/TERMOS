import { useState } from 'react'
import { useStore, type PendingRequest } from '../store'
import { Modal } from './ui'

function HostKey({ r }: { r: Extract<PendingRequest, { type: 'hostkey' }> }): React.JSX.Element {
  const answer = useStore((s) => s.answer)
  return (
    <Modal
      title={r.changed ? '⚠ Host key BERUBAH' : 'Host baru'}
      onClose={() => answer(r.requestId, false)}
      footer={
        <>
          <button className="btn" onClick={() => answer(r.requestId, false)}>
            Tolak
          </button>
          <button
            className={'btn ' + (r.changed ? 'danger' : 'primary')}
            onClick={() => answer(r.requestId, true)}
          >
            {r.changed ? 'Ganti & lanjutkan' : 'Percayai & lanjutkan'}
          </button>
        </>
      }
    >
      {r.changed ? (
        <div className="alert error small">
          Fingerprint host ini berbeda dari yang tersimpan. Bisa jadi server diinstal ulang, atau
          ada yang menyadap koneksi (MITM). Jangan lanjutkan kalau tidak yakin.
        </div>
      ) : (
        <p className="muted">
          Termos belum pernah terhubung ke host ini. Cocokkan fingerprint-nya sebelum melanjutkan.
        </p>
      )}
      <p className="small muted" style={{ marginBottom: 4 }}>
        {r.host}:{r.port} · {r.keyType}
      </p>
      <div className="fp">{r.fingerprint}</div>
    </Modal>
  )
}

function Prompt({ r }: { r: Extract<PendingRequest, { type: 'prompt' }> }): React.JSX.Element {
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
            Batal
          </button>
          <button className="btn primary" onClick={submit}>
            Kirim
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
