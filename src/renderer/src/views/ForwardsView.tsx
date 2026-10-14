import { useEffect, useState } from 'react'
import { newId } from '../../../shared/merge'
import type { ForwardRule, ForwardStatus } from '../../../shared/types'
import { api, bridge, errMsg } from '../api'
import { useT, fmt } from '../i18n'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { confirmDialog } from '../lib'

const S = {
  id: {
    viaServer: '(lewat server)',
    fromHere: '(dari sini)',
    socksAt: 'SOCKS5 di %s',
    editRule: 'Edit aturan',
    newRule: 'Aturan forwarding baru',
    cancel: 'Batal',
    save: 'Simpan',
    label: 'Nama',
    labelPh: 'Postgres prod',
    type: 'Tipe',
    typeLocal: 'Local (-L)',
    typeRemote: 'Remote (-R)',
    typeDynamic: 'Dynamic / SOCKS (-D)',
    viaHost: 'Lewat host SSH',
    bindOnServer: 'Bind address (di server)',
    bindOnLaptop: 'Bind address (di laptop)',
    bindPort: 'Bind port',
    destFromServer: 'Tujuan (dilihat dari server)',
    destFromLaptop: 'Tujuan (dilihat dari laptop)',
    destPort: 'Port tujuan',
    title: 'Port forwarding',
    newRuleBtn: 'Aturan baru',
    emptyRules:
      'Belum ada aturan. Contoh: buka database di server lewat localhost:5432 tanpa membuka port-nya ke internet.',
    needSshHost: 'Tambahkan host SSH dulu di menu Hosts; forwarding berjalan lewat koneksi SSH.',
    thStatus: 'Status',
    thName: 'Nama',
    thType: 'Jenis',
    thDir: 'Arah',
    thVia: 'Lewat',
    stActive: 'aktif',
    stFailed: 'gagal',
    stOff: 'mati',
    hostDeleted: '(host terhapus)',
    connecting: 'Menghubungkan',
    start: 'Start',
    stop: 'Stop',
    edit: 'Edit',
    deleteRule: 'Hapus aturan',
    deleteRuleMsg: 'Hapus "%s"?',
    del: 'Hapus'
  },
  en: {
    viaServer: '(via server)',
    fromHere: '(from this device)',
    socksAt: 'SOCKS5 at %s',
    editRule: 'Edit rule',
    newRule: 'New forwarding rule',
    cancel: 'Cancel',
    save: 'Save',
    label: 'Name',
    labelPh: 'Postgres prod',
    type: 'Type',
    typeLocal: 'Local (-L)',
    typeRemote: 'Remote (-R)',
    typeDynamic: 'Dynamic / SOCKS (-D)',
    viaHost: 'Via SSH host',
    bindOnServer: 'Bind address (on the server)',
    bindOnLaptop: 'Bind address (on this laptop)',
    bindPort: 'Bind port',
    destFromServer: 'Destination (as seen from the server)',
    destFromLaptop: 'Destination (as seen from this laptop)',
    destPort: 'Destination port',
    title: 'Port forwarding',
    newRuleBtn: 'New rule',
    emptyRules:
      'No rules yet. Example: reach a database on the server through localhost:5432 without exposing its port to the internet.',
    needSshHost:
      'Add an SSH host in the Hosts menu first; forwarding runs over the SSH connection.',
    thStatus: 'Status',
    thName: 'Name',
    thType: 'Type',
    thDir: 'Direction',
    thVia: 'Via',
    stActive: 'active',
    stFailed: 'failed',
    stOff: 'off',
    hostDeleted: '(host deleted)',
    connecting: 'Connecting',
    start: 'Start',
    stop: 'Stop',
    edit: 'Edit',
    deleteRule: 'Delete rule',
    deleteRuleMsg: 'Delete "%s"?',
    del: 'Delete'
  }
}

function describe(r: ForwardRule): string {
  const tr = S[useStore.getState().lang]
  const bind = `${r.bindAddress || '127.0.0.1'}:${r.bindPort}`
  if (r.type === 'local') return `${bind} → ${r.destHost}:${r.destPort} ${tr.viaServer}`
  if (r.type === 'remote') return `server ${bind} → ${r.destHost}:${r.destPort} ${tr.fromHere}`
  return fmt(tr.socksAt, bind)
}

function RuleEditor({ rule, onClose }: { rule?: ForwardRule; onClose(): void }): React.JSX.Element {
  const t = useT(S)
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
      title={rule ? t.editRule : t.newRule}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={async () => {
              await api.upsert('forwardRules', r)
              onClose()
            }}
          >
            {t.save}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={t.label}>
          <input
            className="input"
            autoFocus
            value={r.label}
            onChange={(e) => setR({ ...r, label: e.target.value })}
            placeholder={t.labelPh}
          />
        </Field>
        <Field label={t.type}>
          <select
            className="select"
            value={r.type}
            onChange={(e) => setR({ ...r, type: e.target.value as ForwardRule['type'] })}
          >
            <option value="local">{t.typeLocal}</option>
            <option value="remote">{t.typeRemote}</option>
            <option value="dynamic">{t.typeDynamic}</option>
          </select>
        </Field>
      </div>
      <Field label={t.viaHost}>
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
        <Field label={r.type === 'remote' ? t.bindOnServer : t.bindOnLaptop}>
          <input
            className="input"
            value={r.bindAddress}
            onChange={(e) => setR({ ...r, bindAddress: e.target.value })}
          />
        </Field>
        <Field label={t.bindPort}>
          <input
            className="input"
            value={r.bindPort}
            onChange={(e) => setR({ ...r, bindPort: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      {r.type !== 'dynamic' && (
        <div className="grid-2">
          <Field label={r.type === 'local' ? t.destFromServer : t.destFromLaptop}>
            <input
              className="input"
              value={r.destHost ?? ''}
              onChange={(e) => setR({ ...r, destHost: e.target.value })}
            />
          </Field>
          <Field label={t.destPort}>
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
  const t = useT(S)
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
        <h1>{t.title}</h1>
        <span className="grow" />
        <button
          className="btn primary"
          onClick={() => setEditing({})}
          disabled={!data.hosts.some((h) => h.protocol === 'ssh')}
        >
          {t.newRuleBtn}
        </button>
      </div>
      {data.forwardRules.length === 0 ? (
        <div className="empty">
          <p>{t.emptyRules}</p>
          {!data.hosts.some((h) => h.protocol === 'ssh') && (
            <p className="muted">{t.needSshHost}</p>
          )}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.thStatus}</th>
              <th>{t.thName}</th>
              <th>{t.thType}</th>
              <th>{t.thDir}</th>
              <th>{t.thVia}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.forwardRules.map((r) => {
              const s = st(r.id)
              const host = data.hosts.find((h) => h.id === r.hostId)
              return (
                <tr key={r.id}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span
                        className={'dot ' + (s?.active ? 'connected' : s?.error ? 'error' : '')}
                      />
                      {s?.active ? t.stActive : s?.error ? t.stFailed : t.stOff}
                    </span>
                  </td>
                  <td>
                    <div className="cell-title">{r.label}</div>
                    {s?.error && (
                      <div className="small" style={{ color: 'var(--danger)' }}>
                        {s.error}
                      </div>
                    )}
                  </td>
                  <td className="muted">{r.type}</td>
                  <td className="mono small">{describe(r)}</td>
                  <td className="muted">{host?.label ?? t.hostDeleted}</td>
                  <td className="actions">
                    {s?.active ? (
                      <button className="btn sm" onClick={() => void api.forwardStop(r.id)}>
                        {t.stop}
                      </button>
                    ) : (
                      <button
                        className="btn sm"
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
                        {busy === r.id ? t.connecting : t.start}
                      </button>
                    )}
                    <button className="btn sm ghost" onClick={() => setEditing({ v: r })}>
                      {t.edit}
                    </button>
                    <button
                      className="btn sm ghost danger"
                      onClick={async () => {
                        if (
                          await confirmDialog(t.deleteRule, fmt(t.deleteRuleMsg, r.label), {
                            danger: true,
                            okLabel: t.del
                          })
                        ) {
                          await api.forwardStop(r.id)
                          await api.remove('forwardRules', r.id)
                        }
                      }}
                    >
                      {t.del}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {editing && <RuleEditor rule={editing.v} onClose={() => setEditing(null)} />}
    </div>
  )
}
