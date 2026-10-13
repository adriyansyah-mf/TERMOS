import { useEffect, useState } from 'react'
import { newId } from '../../../shared/merge'
import type { ForwardRule, ForwardStatus } from '../../../shared/types'
import { api, bridge, errMsg } from '../api'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { confirmDialog } from '../lib'

function describe(r: ForwardRule): string {
  const bind = `${r.bindAddress || '127.0.0.1'}:${r.bindPort}`
  if (r.type === 'local') return `${bind} → ${r.destHost}:${r.destPort} (lewat server)`
  if (r.type === 'remote') return `server ${bind} → ${r.destHost}:${r.destPort} (dari sini)`
  return `SOCKS5 di ${bind}`
}

function RuleEditor({ rule, onClose }: { rule?: ForwardRule; onClose(): void }): React.JSX.Element {
  const hosts = useStore((s) => (s.data?.hosts ?? []).filter((h) => h.protocol === 'ssh'))
  const [r, setR] = useState<ForwardRule>(
    rule ?? {
      id: newId(),
      updatedAt: 0,
      label: '',
      type: 'local',
      hostId: hosts[0]?.id ?? '',
      bindAddress: '127.0.0.1',
      bindPort: 8080,
      destHost: '127.0.0.1',
      destPort: 80
    }
  )
  const valid =
    r.label.trim() &&
    r.hostId &&
    r.bindPort > 0 &&
    (r.type === 'dynamic' || (r.destHost && r.destPort))
  return (
    <Modal
      title={rule ? 'Edit aturan' : 'Aturan forwarding baru'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              await api.upsert('forwardRules', r)
              onClose()
            }}
          >
            Simpan
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Nama">
          <input
            className="input"
            autoFocus
            value={r.label}
            onChange={(e) => setR({ ...r, label: e.target.value })}
            placeholder="Postgres prod"
          />
        </Field>
        <Field label="Tipe">
          <select
            className="select"
            value={r.type}
            onChange={(e) => setR({ ...r, type: e.target.value as ForwardRule['type'] })}
          >
            <option value="local">Local (-L)</option>
            <option value="remote">Remote (-R)</option>
            <option value="dynamic">Dynamic / SOCKS (-D)</option>
          </select>
        </Field>
      </div>
      <Field label="Lewat host SSH">
        <select
          className="select"
          value={r.hostId}
          onChange={(e) => setR({ ...r, hostId: e.target.value })}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field
          label={r.type === 'remote' ? 'Bind address (di server)' : 'Bind address (di laptop)'}
        >
          <input
            className="input"
            value={r.bindAddress}
            onChange={(e) => setR({ ...r, bindAddress: e.target.value })}
          />
        </Field>
        <Field label="Bind port">
          <input
            className="input"
            value={r.bindPort}
            onChange={(e) => setR({ ...r, bindPort: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      {r.type !== 'dynamic' && (
        <div className="grid-2">
          <Field
            label={
              r.type === 'local' ? 'Tujuan (dilihat dari server)' : 'Tujuan (dilihat dari laptop)'
            }
          >
            <input
              className="input"
              value={r.destHost ?? ''}
              onChange={(e) => setR({ ...r, destHost: e.target.value })}
            />
          </Field>
          <Field label="Port tujuan">
            <input
              className="input"
              value={r.destPort ?? ''}
              onChange={(e) => setR({ ...r, destPort: Number(e.target.value) || undefined })}
            />
          </Field>
        </div>
      )}
      <p className="dim small">{describe(r)}</p>
    </Modal>
  )
}

export function ForwardsView(): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const toast = useStore((s) => s.toast)
  const [status, setStatus] = useState<ForwardStatus[]>([])
  const [editing, setEditing] = useState<{ v?: ForwardRule } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void api.forwardStatus().then(setStatus)
    return bridge.on('forwards:status', setStatus)
  }, [data.forwardRules.length])

  const st = (id: string): ForwardStatus | undefined => status.find((s) => s.ruleId === id)

  return (
    <div className="view">
      <div className="view-head">
        <h1>Port Forwarding</h1>
        <span className="grow" />
        <button
          className="btn primary"
          onClick={() => setEditing({})}
          disabled={!data.hosts.some((h) => h.protocol === 'ssh')}
        >
          + Aturan
        </button>
      </div>
      {data.forwardRules.length === 0 ? (
        <div className="empty">
          <div className="big">⇄</div>
          Belum ada aturan. Contoh: akses database di server lewat localhost:5432.
        </div>
      ) : (
        <div className="list">
          {data.forwardRules.map((r) => {
            const s = st(r.id)
            const host = data.hosts.find((h) => h.id === r.hostId)
            return (
              <div key={r.id} className="list-row">
                <span className={'dot ' + (s?.active ? 'connected' : s?.error ? 'error' : '')} />
                <div className="grow ellipsis">
                  <div className="title">
                    {r.label} <span className="tag">{r.type}</span>
                  </div>
                  <div className="dim small">
                    {describe(r)} · via {host?.label ?? '?'}
                  </div>
                  {s?.error && (
                    <div className="small" style={{ color: 'var(--danger)' }}>
                      {s.error}
                    </div>
                  )}
                </div>
                {s?.active ? (
                  <button className="btn sm" onClick={() => void api.forwardStop(r.id)}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn sm ok"
                    disabled={busy === r.id}
                    onClick={async () => {
                      setBusy(r.id)
                      try {
                        await api.forwardStart(r.id)
                      } catch (e) {
                        toast(errMsg(e), 'error')
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    {busy === r.id ? 'Menghubungkan…' : 'Start'}
                  </button>
                )}
                <button className="btn sm" onClick={() => setEditing({ v: r })}>
                  Edit
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (
                      await confirmDialog('Hapus aturan', `Hapus "${r.label}"?`, {
                        danger: true,
                        okLabel: 'Hapus'
                      })
                    ) {
                      await api.forwardStop(r.id)
                      await api.remove('forwardRules', r.id)
                    }
                  }}
                >
                  Hapus
                </button>
              </div>
            )
          })}
        </div>
      )}
      {editing && <RuleEditor rule={editing.v} onClose={() => setEditing(null)} />}
    </div>
  )
}
