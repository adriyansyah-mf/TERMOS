import { useEffect, useState } from 'react'
import { resolveConfigValue, newId } from '../../../shared/merge'
import type { ConnConfig, Group, Host, Protocol } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { THEMES } from '../themes'
import { Check, Field, Modal } from '../components/ui'
import { VaultSelect } from '../components/VaultSelect'
import { fmt, useT } from '../i18n'

const S = {
  id: {
    inheritedFrom: 'Diwarisi dari grup',
    username: 'Username',
    port: 'Port',
    password: 'Password',
    sshKey: 'SSH key',
    none: '(tidak ada)',
    identity: 'Identity (user + password/key tersimpan)',
    jumpHost: 'Jump host (urutan dari yang pertama)',
    jumpHostHint: 'Koneksi lewat host-host ini dulu (ProxyJump).',
    addJumpHost: '+ tambah jump host',
    proxy: 'Proxy',
    direct: '(langsung)',
    startupSnippet: 'Snippet saat login',
    sshEngine: 'Engine SSH',
    sshEngineHint: 'OpenSSH sistem diperlukan untuk sertifikat SSH dan key FIDO2/YubiKey.',
    engineBuiltin: 'Bawaan Termos',
    engineOpenSsh: 'OpenSSH sistem (ssh)',
    moshCommand: 'Perintah mosh',
    moshCommandHint: 'Default: mosh',
    useAgent: 'Pakai SSH agent',
    agentForwarding: 'Agent forwarding',
    autoForward: 'Port forwarding otomatis saat terhubung',
    noForwardRules: 'Belum ada aturan untuk host ini (buat di menu Port Forwarding).',
    envVar: 'Environment variable',
    envVarHint: 'Butuh AcceptEnv di server untuk engine bawaan.',
    envName: 'NAMA',
    envValue: 'nilai',
    addVariable: '+ Variabel',
    theme: 'Tema terminal',
    defaultOption: '(default)',
    fontSize: 'Ukuran font',
    charset: 'Charset',
    keepalive: 'Keepalive (detik)',
    connTimeout: 'Timeout koneksi (detik)',
    logSession: 'Simpan log sesi ke file',
    editHostTitle: 'Edit %s',
    newHost: 'Host baru',
    cancel: 'Batal',
    save: 'Simpan',
    name: 'Nama',
    protocol: 'Protokol',
    localTerminal: 'Terminal lokal',
    serialPort: 'Port serial',
    baudRate: 'Baud rate',
    address: 'Alamat (IP atau hostname)',
    group: 'Grup',
    noGroup: '(tanpa grup)',
    tags: 'Tag (pisahkan dengan koma)',
    connection: 'Koneksi',
    editGroupTitle: 'Edit grup %s',
    newGroup: 'Grup baru',
    groupName: 'Nama grup',
    parent: 'Induk',
    groupInheritHint:
      'Pengaturan di bawah dipakai oleh semua host di grup ini yang tidak mengisinya sendiri.'
  },
  en: {
    inheritedFrom: 'Inherited from group',
    username: 'Username',
    port: 'Port',
    password: 'Password',
    sshKey: 'SSH key',
    none: '(none)',
    identity: 'Identity (saved user + password/key)',
    jumpHost: 'Jump host (in order of use)',
    jumpHostHint: 'Connect through these hosts first (ProxyJump).',
    addJumpHost: '+ Add jump host',
    proxy: 'Proxy',
    direct: '(direct)',
    startupSnippet: 'Snippet on login',
    sshEngine: 'SSH engine',
    sshEngineHint: 'System OpenSSH is required for SSH certificates and FIDO2/YubiKey keys.',
    engineBuiltin: 'Termos built-in',
    engineOpenSsh: 'System OpenSSH (ssh)',
    moshCommand: 'Mosh command',
    moshCommandHint: 'Default: mosh',
    useAgent: 'Use SSH agent',
    agentForwarding: 'Agent forwarding',
    autoForward: 'Automatic port forwarding when connected',
    noForwardRules: 'No rules for this host yet (create them in the Port Forwarding menu).',
    envVar: 'Environment variable',
    envVarHint: 'Requires AcceptEnv on the server for the built-in engine.',
    envName: 'NAME',
    envValue: 'value',
    addVariable: '+ Variable',
    theme: 'Terminal theme',
    defaultOption: '(default)',
    fontSize: 'Font size',
    charset: 'Charset',
    keepalive: 'Keepalive (seconds)',
    connTimeout: 'Connection timeout (seconds)',
    logSession: 'Save session log to file',
    editHostTitle: 'Edit %s',
    newHost: 'New host',
    cancel: 'Cancel',
    save: 'Save',
    name: 'Name',
    protocol: 'Protocol',
    localTerminal: 'Local terminal',
    serialPort: 'Serial port',
    baudRate: 'Baud rate',
    address: 'Address (IP or hostname)',
    group: 'Group',
    noGroup: '(no group)',
    tags: 'Tags (comma-separated)',
    connection: 'Connection',
    editGroupTitle: 'Edit group %s',
    newGroup: 'New group',
    groupName: 'Group name',
    parent: 'Parent',
    groupInheritHint:
      'The settings below apply to every host in this group that does not set its own.'
  }
}

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
  const t = useT(S)
  const own = props.host.config[props.k]
  if (own !== undefined && own !== '') return null
  const r = resolveConfigValue({ config: {}, groupId: props.host.groupId }, props.groups, props.k)
  if (r.value === undefined) return null
  const g = props.groups.find((x) => x.id === r.source)
  const v = props.k === 'password' ? '••••' : String(r.value)
  return (
    <span>
      {t.inheritedFrom} <b>{g?.label}</b>: {v}
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
  const t = useT(S)
  const c = props.value
  const set = (patch: Partial<ConnConfig>): void => props.onChange({ ...c, ...patch })
  const inh = (k: keyof ConnConfig): React.JSX.Element | null =>
    props.inheritFrom ? <Inherit host={props.inheritFrom} groups={data.groups} k={k} /> : null
  const proto = props.protocol ?? 'ssh'
  const sshLike = proto === 'ssh' || proto === 'mosh'

  return (
    <>
      <div className="grid-2">
        <Field label={t.username} hint={inh('username')}>
          <input
            className="input"
            value={c.username ?? ''}
            onChange={(e) => set({ username: e.target.value || undefined })}
          />
        </Field>
        <Field label={t.port} hint={inh('port')}>
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
            <Field label={t.password} hint={inh('password')}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={c.password ?? ''}
                onChange={(e) => set({ password: e.target.value || undefined })}
              />
            </Field>
            <Field label={t.sshKey} hint={inh('keyId')}>
              <select
                className="select"
                value={c.keyId ?? ''}
                onChange={(e) => set({ keyId: e.target.value || undefined })}
              >
                <option value="">{t.none}</option>
                {data.keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} ({k.keyType})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t.identity} hint={inh('identityId')}>
            <select
              className="select"
              value={c.identityId ?? ''}
              onChange={(e) => set({ identityId: e.target.value || undefined })}
            >
              <option value="">{t.none}</option>
              {data.identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label} ({i.username})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.jumpHost} hint={inh('hostChain') ?? t.jumpHostHint}>
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
                <option value="">{t.addJumpHost}</option>
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
            <Field label={t.proxy} hint={inh('proxyId')}>
              <select
                className="select"
                value={c.proxyId ?? ''}
                onChange={(e) => set({ proxyId: e.target.value || undefined })}
              >
                <option value="">{t.direct}</option>
                {data.proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.type})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.startupSnippet} hint={inh('startupSnippetId')}>
              <select
                className="select"
                value={c.startupSnippetId ?? ''}
                onChange={(e) => set({ startupSnippetId: e.target.value || undefined })}
              >
                <option value="">{t.none}</option>
                {data.snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {proto === 'ssh' && (
            <Field label={t.sshEngine} hint={t.sshEngineHint}>
              <select
                className="select"
                value={c.engine ?? 'builtin'}
                onChange={(e) =>
                  set({ engine: e.target.value === 'openssh' ? 'openssh' : undefined })
                }
              >
                <option value="builtin">{t.engineBuiltin}</option>
                <option value="openssh">{t.engineOpenSsh}</option>
              </select>
            </Field>
          )}
          {proto === 'mosh' && (
            <Field label={t.moshCommand} hint={t.moshCommandHint}>
              <input
                className="input"
                value={c.moshCommand ?? ''}
                onChange={(e) => set({ moshCommand: e.target.value || undefined })}
              />
            </Field>
          )}
          <div className="grid-2">
            <Check
              label={t.useAgent}
              checked={c.useAgent !== false}
              onChange={(v) => set({ useAgent: v ? undefined : false })}
            />
            <Check
              label={t.agentForwarding}
              checked={!!c.agentForwarding}
              onChange={(v) => set({ agentForwarding: v || undefined })}
            />
          </div>
          <Field label={t.autoForward}>
            <div className="row wrap">
              {data.forwardRules.filter((r) => !props.selfId || r.hostId === props.selfId)
                .length === 0 && <span className="dim small">{t.noForwardRules}</span>}
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
          <Field label={t.envVar} hint={t.envVarHint}>
            {(c.env ?? []).map((e, i) => (
              <div className="row" key={i} style={{ marginBottom: 6 }}>
                <input
                  className="input mono"
                  placeholder={t.envName}
                  value={e.key}
                  onChange={(ev) =>
                    set({
                      env: c.env!.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x))
                    })
                  }
                />
                <input
                  className="input mono"
                  placeholder={t.envValue}
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
                {t.addVariable}
              </button>
            </div>
          </Field>
        </>
      )}
      <div className="grid-3">
        <Field label={t.theme} hint={inh('theme')}>
          <select
            className="select"
            value={c.theme ?? ''}
            onChange={(e) => set({ theme: e.target.value || undefined })}
          >
            <option value="">{t.defaultOption}</option>
            {Object.entries(THEMES).map(([k, th]) => (
              <option key={k} value={k}>
                {th.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.fontSize}>
          <input
            className="input"
            inputMode="numeric"
            value={c.fontSize ?? ''}
            onChange={(e) => set({ fontSize: num(e.target.value) })}
          />
        </Field>
        <Field label={t.charset}>
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
          <Field label={t.keepalive}>
            <input
              className="input"
              inputMode="numeric"
              placeholder="30"
              value={c.keepAliveInterval ?? ''}
              onChange={(e) => set({ keepAliveInterval: num(e.target.value) })}
            />
          </Field>
          <Field label={t.connTimeout}>
            <input
              className="input"
              inputMode="numeric"
              placeholder="20"
              value={c.timeout ?? ''}
              onChange={(e) => set({ timeout: num(e.target.value) })}
            />
          </Field>
        </div>
      )}
      <Check
        label={t.logSession}
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
  const t = useT(S)
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
        .map((tag) => tag.trim())
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
      title={props.host ? fmt(t.editHostTitle, props.host.label) : t.newHost}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {t.cancel}
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {t.save}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={t.name}>
          <input
            className="input"
            autoFocus
            value={h.label}
            onChange={(e) => setH({ ...h, label: e.target.value })}
            placeholder="web-server-01"
          />
        </Field>
        <Field label={t.protocol}>
          <select
            className="select"
            value={h.protocol}
            onChange={(e) => setH({ ...h, protocol: e.target.value as Protocol })}
          >
            <option value="ssh">SSH</option>
            <option value="mosh">Mosh</option>
            <option value="telnet">Telnet</option>
            <option value="serial">Serial</option>
            <option value="local">{t.localTerminal}</option>
          </select>
        </Field>
      </div>
      {h.protocol === 'serial' ? (
        <div className="grid-2">
          <Field label={t.serialPort}>
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
          <Field label={t.baudRate}>
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
          <Field label={t.address}>
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
        <Field label={t.group}>
          <select
            className="select"
            value={h.groupId ?? ''}
            onChange={(e) => setH({ ...h, groupId: e.target.value || undefined })}
          >
            <option value="">{t.noGroup}</option>
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.tags}>
          <input
            className="input"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="prod, web"
          />
        </Field>
      </div>
      <VaultSelect value={h.teamId} onChange={(teamId) => setH({ ...h, teamId })} />
      {h.protocol !== 'local' && h.protocol !== 'serial' && (
        <>
          <div className="section-title">{t.connection}</div>
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
  const t = useT(S)
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
      title={props.group ? fmt(t.editGroupTitle, props.group.label) : t.newGroup}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {t.cancel}
          </button>
          <button className="btn primary" disabled={!g.label.trim()} onClick={save}>
            {t.save}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={t.groupName}>
          <input
            className="input"
            autoFocus
            value={g.label}
            onChange={(e) => setG({ ...g, label: e.target.value })}
          />
        </Field>
        <Field label={t.parent}>
          <select
            className="select"
            value={g.parentId ?? ''}
            onChange={(e) => setG({ ...g, parentId: e.target.value || undefined })}
          >
            <option value="">{t.none}</option>
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
      <VaultSelect value={g.teamId} onChange={(teamId) => setG({ ...g, teamId })} />
      <p className="dim small">{t.groupInheritHint}</p>
      <ConnFields value={g.config} onChange={(config) => setG({ ...g, config })} />
    </Modal>
  )
}
