import { useEffect, useState } from 'react'
import { resolveConfigValue, newId } from '../../../shared/merge'
import type { ConnConfig, Group, Host, Protocol } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { THEMES } from '../themes'
import { Check, Field, Modal } from '../components/ui'

const DEFAULT_PORT: Record<Protocol, number | undefined> = {
  ssh: 22,
  mosh: 22,
  telnet: 23,
  serial: undefined,
  local: undefined
}

const num = (v: string): number | undefined => (v.trim() ? Number(v) : undefined)

/** Shows what a blank field inherits from its group chain. */
function Inherit<K extends keyof ConnConfig>(props: {
  host: Pick<Host, 'config' | 'groupId'>
  groups: Group[]
  k: K
}): React.JSX.Element | null {
  const own = props.host.config[props.k]
  if (own !== undefined && own !== '') return null
  const r = resolveConfigValue({ config: {}, groupId: props.host.groupId }, props.groups, props.k)
  if (r.value === undefined) return null
  const g = props.groups.find((x) => x.id === r.source)
  const v = props.k === 'password' ? '••••' : String(r.value)
  return (
    <span>
      Diwarisi dari grup <b>{g?.label}</b>: {v}
    </span>
  )
}

/** Connection options shared by host and group editors. */
function ConnFields(props: {
  value: ConnConfig
  onChange(c: ConnConfig): void
  inheritFrom?: Pick<Host, 'config' | 'groupId'>
  protocol?: Protocol
  selfId?: string
}): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const c = props.value
  const set = (patch: Partial<ConnConfig>): void => props.onChange({ ...c, ...patch })
  const inh = (k: keyof ConnConfig): React.JSX.Element | null =>
    props.inheritFrom ? <Inherit host={props.inheritFrom} groups={data.groups} k={k} /> : null
  const proto = props.protocol ?? 'ssh'
  const sshLike = proto === 'ssh' || proto === 'mosh'

  return (
    <>
      <div className="grid-2">
        <Field label="Username" hint={inh('username')}>
          <input
            className="input"
            value={c.username ?? ''}
            onChange={(e) => set({ username: e.target.value || undefined })}
          />
        </Field>
        <Field label="Port" hint={inh('port')}>
          <input
            className="input"
            inputMode="numeric"
            placeholder={String(DEFAULT_PORT[proto] ?? '')}
            value={c.port ?? ''}
            onChange={(e) => set({ port: num(e.target.value) })}
          />
        </Field>
      </div>
      {sshLike && (
        <>
          <div className="grid-2">
            <Field label="Password" hint={inh('password')}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={c.password ?? ''}
                onChange={(e) => set({ password: e.target.value || undefined })}
              />
            </Field>
            <Field label="SSH key" hint={inh('keyId')}>
              <select
                className="select"
                value={c.keyId ?? ''}
                onChange={(e) => set({ keyId: e.target.value || undefined })}
              >
                <option value="">(tidak ada)</option>
                {data.keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} ({k.keyType})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Identity (user + password/key tersimpan)" hint={inh('identityId')}>
            <select
              className="select"
              value={c.identityId ?? ''}
              onChange={(e) => set({ identityId: e.target.value || undefined })}
            >
              <option value="">(tidak ada)</option>
              {data.identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label} ({i.username})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Jump host (urutan dari yang pertama)"
            hint={inh('hostChain') ?? 'Koneksi lewat host-host ini dulu (ProxyJump).'}
          >
            <div className="row wrap">
              {(c.hostChain ?? []).map((id, i) => {
                const h = data.hosts.find((x) => x.id === id)
                return (
                  <span key={id + i} className="tag">
                    {h?.label ?? '?'}{' '}
                    <a
                      style={{ cursor: 'pointer' }}
                      onClick={() => set({ hostChain: c.hostChain!.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </a>
                  </span>
                )
              })}
              <select
                className="select"
                style={{ width: 200 }}
                value=""
                onChange={(e) =>
                  e.target.value && set({ hostChain: [...(c.hostChain ?? []), e.target.value] })
                }
              >
                <option value="">+ tambah jump host</option>
                {data.hosts
                  .filter((h) => h.id !== props.selfId && h.protocol === 'ssh')
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
              </select>
            </div>
          </Field>
          <div className="grid-2">
            <Field label="Proxy" hint={inh('proxyId')}>
              <select
                className="select"
                value={c.proxyId ?? ''}
                onChange={(e) => set({ proxyId: e.target.value || undefined })}
              >
                <option value="">(langsung)</option>
                {data.proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.type})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Snippet saat login" hint={inh('startupSnippetId')}>
              <select
                className="select"
                value={c.startupSnippetId ?? ''}
                onChange={(e) => set({ startupSnippetId: e.target.value || undefined })}
              >
                <option value="">(tidak ada)</option>
                {data.snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {proto === 'ssh' && (
            <Field
              label="Engine SSH"
              hint="OpenSSH sistem diperlukan untuk sertifikat SSH dan key FIDO2/YubiKey."
            >
              <select
                className="select"
                value={c.engine ?? 'builtin'}
                onChange={(e) =>
                  set({ engine: e.target.value === 'openssh' ? 'openssh' : undefined })
                }
              >
                <option value="builtin">Bawaan Termos</option>
                <option value="openssh">OpenSSH sistem (ssh)</option>
              </select>
            </Field>
          )}
          {proto === 'mosh' && (
            <Field label="Perintah mosh" hint="Default: mosh">
              <input
                className="input"
                value={c.moshCommand ?? ''}
                onChange={(e) => set({ moshCommand: e.target.value || undefined })}
              />
            </Field>
          )}
          <div className="grid-2">
            <Check
              label="Pakai SSH agent"
              checked={c.useAgent !== false}
              onChange={(v) => set({ useAgent: v ? undefined : false })}
            />
            <Check
              label="Agent forwarding"
              checked={!!c.agentForwarding}
              onChange={(v) => set({ agentForwarding: v || undefined })}
            />
          </div>
          <Field label="Port forwarding otomatis saat terhubung">
            <div className="row wrap">
              {data.forwardRules.filter((r) => !props.selfId || r.hostId === props.selfId)
                .length === 0 && (
                <span className="dim small">
                  Belum ada aturan untuk host ini (buat di menu Port Forwarding).
                </span>
              )}
              {data.forwardRules
                .filter((r) => !props.selfId || r.hostId === props.selfId)
                .map((r) => (
                  <Check
                    key={r.id}
                    label={r.label}
                    checked={(c.forwardRuleIds ?? []).includes(r.id)}
                    onChange={(v) =>
                      set({
                        forwardRuleIds: v
                          ? [...(c.forwardRuleIds ?? []), r.id]
                          : (c.forwardRuleIds ?? []).filter((x) => x !== r.id)
                      })
                    }
                  />
                ))}
            </div>
          </Field>
          <Field label="Environment variable" hint="Butuh AcceptEnv di server untuk engine bawaan.">
            {(c.env ?? []).map((e, i) => (
              <div className="row" key={i} style={{ marginBottom: 6 }}>
                <input
                  className="input mono"
                  placeholder="NAMA"
                  value={e.key}
                  onChange={(ev) =>
                    set({
                      env: c.env!.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x))
                    })
                  }
                />
                <input
                  className="input mono"
                  placeholder="nilai"
                  value={e.value}
                  onChange={(ev) =>
                    set({
                      env: c.env!.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x))
                    })
                  }
                />
                <button
                  className="btn sm ghost"
                  onClick={() => set({ env: c.env!.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button
                className="btn sm"
                onClick={() => set({ env: [...(c.env ?? []), { key: '', value: '' }] })}
              >
                + Variabel
              </button>
            </div>
          </Field>
        </>
      )}
      <div className="grid-3">
        <Field label="Tema terminal" hint={inh('theme')}>
          <select
            className="select"
            value={c.theme ?? ''}
            onChange={(e) => set({ theme: e.target.value || undefined })}
          >
            <option value="">(default)</option>
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
            inputMode="numeric"
            value={c.fontSize ?? ''}
            onChange={(e) => set({ fontSize: num(e.target.value) })}
          />
        </Field>
        <Field label="Charset">
          <input
            className="input"
            placeholder="utf-8"
            value={c.charset ?? ''}
            onChange={(e) => set({ charset: e.target.value || undefined })}
          />
        </Field>
      </div>
      {sshLike && (
        <div className="grid-2">
          <Field label="Keepalive (detik)">
            <input
              className="input"
              placeholder="30"
              value={c.keepAliveInterval ?? ''}
              onChange={(e) => set({ keepAliveInterval: num(e.target.value) })}
            />
          </Field>
          <Field label="Timeout koneksi (detik)">
            <input
              className="input"
              placeholder="20"
              value={c.timeout ?? ''}
              onChange={(e) => set({ timeout: num(e.target.value) })}
            />
          </Field>
        </div>
      )}
      <Check
        label="Simpan log sesi ke file"
        checked={!!c.logSession}
        onChange={(v) => set({ logSession: v || undefined })}
      />
    </>
  )
}

export function HostEditor(props: {
  host?: Host
  groupId?: string
  onClose(): void
}): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const toast = useStore((s) => s.toast)
  const [h, setH] = useState<Host>(
    () =>
      props.host ?? {
        id: newId(),
        updatedAt: 0,
        label: '',
        address: '',
        protocol: 'ssh',
        groupId: props.groupId,
        tags: [],
        config: {}
      }
  )
  const [tagText, setTagText] = useState(h.tags.join(', '))
  const [ports, setPorts] = useState<{ path: string; label: string }[]>([])

  useEffect(() => {
    if (h.protocol === 'serial') api.serialPorts().then(setPorts, () => setPorts([]))
  }, [h.protocol])

  const needsAddress = h.protocol !== 'local'
  const valid = h.label.trim() && (!needsAddress || h.address.trim() || h.serial?.path)

  const save = async (): Promise<void> => {
    try {
      const tags = tagText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const address = h.protocol === 'serial' ? (h.serial?.path ?? h.address) : h.address.trim()
      await api.upsert<Host>('hosts', { ...h, label: h.label.trim(), address, tags })
      props.onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  return (
    <Modal
      wide
      title={props.host ? `Edit ${props.host.label}` : 'Host baru'}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
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
            value={h.label}
            onChange={(e) => setH({ ...h, label: e.target.value })}
            placeholder="web-server-01"
          />
        </Field>
        <Field label="Protokol">
          <select
            className="select"
            value={h.protocol}
            onChange={(e) => setH({ ...h, protocol: e.target.value as Protocol })}
          >
            <option value="ssh">SSH</option>
            <option value="mosh">Mosh</option>
            <option value="telnet">Telnet</option>
            <option value="serial">Serial</option>
            <option value="local">Terminal lokal</option>
          </select>
        </Field>
      </div>
      {h.protocol === 'serial' ? (
        <div className="grid-2">
          <Field label="Port serial">
            <input
              className="input"
              list="serial-ports"
              value={h.serial?.path ?? ''}
              placeholder="/dev/ttyUSB0"
              onChange={(e) =>
                setH({
                  ...h,
                  serial: { baudRate: h.serial?.baudRate ?? 9600, path: e.target.value }
                })
              }
            />
            <datalist id="serial-ports">
              {ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="Baud rate">
            <select
              className="select"
              value={h.serial?.baudRate ?? 9600}
              onChange={(e) =>
                setH({
                  ...h,
                  serial: { path: h.serial?.path ?? '', baudRate: Number(e.target.value) }
                })
              }
            >
              {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
        </div>
      ) : (
        needsAddress && (
          <Field label="Alamat (IP atau hostname)">
            <input
              className="input"
              value={h.address}
              onChange={(e) => setH({ ...h, address: e.target.value })}
              placeholder="192.168.1.10"
            />
          </Field>
        )
      )}
      <div className="grid-2">
        <Field label="Grup">
          <select
            className="select"
            value={h.groupId ?? ''}
            onChange={(e) => setH({ ...h, groupId: e.target.value || undefined })}
          >
            <option value="">(tanpa grup)</option>
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tag (pisahkan dengan koma)">
          <input
            className="input"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="prod, web"
          />
        </Field>
      </div>
      {h.protocol !== 'local' && h.protocol !== 'serial' && (
        <>
          <div className="section-title">Koneksi</div>
          <ConnFields
            value={h.config}
            onChange={(config) => setH({ ...h, config })}
            inheritFrom={h}
            protocol={h.protocol}
            selfId={h.id}
          />
        </>
      )}
    </Modal>
  )
}

export function GroupEditor(props: { group?: Group; onClose(): void }): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const toast = useStore((s) => s.toast)
  const [g, setG] = useState<Group>(
    () => props.group ?? { id: newId(), updatedAt: 0, label: '', config: {} }
  )
  const save = async (): Promise<void> => {
    try {
      await api.upsert<Group>('groups', { ...g, label: g.label.trim() })
      props.onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  return (
    <Modal
      wide
      title={props.group ? `Edit grup ${props.group.label}` : 'Grup baru'}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Batal
          </button>
          <button className="btn primary" disabled={!g.label.trim()} onClick={save}>
            Simpan
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Nama grup">
          <input
            className="input"
            autoFocus
            value={g.label}
            onChange={(e) => setG({ ...g, label: e.target.value })}
          />
        </Field>
        <Field label="Induk">
          <select
            className="select"
            value={g.parentId ?? ''}
            onChange={(e) => setG({ ...g, parentId: e.target.value || undefined })}
          >
            <option value="">(tidak ada)</option>
            {data.groups
              .filter((x) => x.id !== g.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <p className="dim small">
        Pengaturan di bawah dipakai oleh semua host di grup ini yang tidak mengisinya sendiri.
      </p>
      <ConnFields value={g.config} onChange={(config) => setG({ ...g, config })} />
    </Modal>
  )
}
