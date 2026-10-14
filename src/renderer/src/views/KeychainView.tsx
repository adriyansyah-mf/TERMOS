import { useEffect, useState } from 'react'
import { newId } from '../../../shared/merge'
import type { Identity, ProxyDef, SshKey } from '../../../shared/types'
import { api, errMsg } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { VaultSelect } from '../components/VaultSelect'
import { confirmDialog } from '../lib'

const S = {
  id: {
    close: 'Tutup',
    fingerprint: 'Fingerprint',
    copied: '%s disalin',
    movedToTeam: 'Key dipindah ke tim',
    movedToPrivate: 'Key dipindah ke vault pribadi',
    teamKeyHint: 'Key di tim (termasuk private key-nya) bisa dipakai semua anggota tim.',
    publicKey: 'Public key',
    publicKeyHint: 'Tempel ke ~/.ssh/authorized_keys di server, atau pakai ssh-copy-id.',
    copyPublicKey: 'Salin public key',
    command: 'Perintah',
    copyInstallCmd: 'Salin perintah pasang ke server',
    newSshKey: 'SSH key baru',
    cancel: 'Batal',
    generateKey: 'Buat key',
    save: 'Simpan',
    generate: 'Buat baru',
    pasteKey: 'Tempel private key',
    name: 'Nama',
    namePh: 'laptop-kantor',
    type: 'Tipe',
    ed25519Rec: 'Ed25519 (disarankan)',
    certOptional: 'Sertifikat (opsional)',
    certHint:
      'Isi *-cert.pub kalau server memakai SSH certificate. Gunakan engine OpenSSH untuk host-nya.',
    passphraseOptional: 'Passphrase (opsional)',
    passHint: 'Disimpan terenkripsi di vault, jadi tidak ditanya tiap konek.',
    keySaved: 'Key disimpan',
    editIdentity: 'Edit identity',
    newIdentity: 'Identity baru',
    identityIntro: 'Identity = username + password/key yang bisa dipakai banyak host sekaligus.',
    none: '(tidak ada)',
    editProxy: 'Edit proxy',
    newProxy: 'Proxy baru',
    proxyCommandOpt: 'Perintah (ProxyCommand)',
    commandHint: '%h = host tujuan, %p = port, %r = user. Contoh: nc -X 5 -x proxy:1080 %h %p',
    usernameOptional: 'Username (opsional)',
    passwordOptional: 'Password (opsional)',
    keyImported: 'Key "%s" diimpor',
    importKeyFile: 'Import file key',
    noKeys: 'Belum ada key. Buat key Ed25519 baru atau import dari ~/.ssh.',
    certHeader: 'Sertifikat',
    stored: 'tersimpan',
    notSet: 'tidak ada',
    yes: 'ada',
    delete: 'Hapus',
    deleteConfirm: 'Hapus "%s"?',
    noIdentities: 'Belum ada identity.',
    loginWith: 'Login dengan',
    askOnConnect: 'tanya saat konek',
    noProxies: 'Belum ada proxy.',
    target: 'Tujuan'
  },
  en: {
    close: 'Close',
    fingerprint: 'Fingerprint',
    copied: '%s copied',
    movedToTeam: 'Key moved to team',
    movedToPrivate: 'Key moved to personal vault',
    teamKeyHint: 'Team keys (including the private key) can be used by every team member.',
    publicKey: 'Public key',
    publicKeyHint: 'Paste into ~/.ssh/authorized_keys on the server, or use ssh-copy-id.',
    copyPublicKey: 'Copy public key',
    command: 'Command',
    copyInstallCmd: 'Copy server install command',
    newSshKey: 'New SSH key',
    cancel: 'Cancel',
    generateKey: 'Generate key',
    save: 'Save',
    generate: 'Generate',
    pasteKey: 'Paste private key',
    name: 'Name',
    namePh: 'work-laptop',
    type: 'Type',
    ed25519Rec: 'Ed25519 (recommended)',
    certOptional: 'Certificate (optional)',
    certHint:
      'Fill in the *-cert.pub if the server uses SSH certificates. Use the OpenSSH engine for that host.',
    passphraseOptional: 'Passphrase (optional)',
    passHint: 'Stored encrypted in the vault, so you are not asked on every connection.',
    keySaved: 'Key saved',
    editIdentity: 'Edit identity',
    newIdentity: 'New identity',
    identityIntro: 'An identity is a username + password/key you can reuse across many hosts.',
    none: '(none)',
    editProxy: 'Edit proxy',
    newProxy: 'New proxy',
    proxyCommandOpt: 'Command (ProxyCommand)',
    commandHint: '%h = target host, %p = port, %r = user. Example: nc -X 5 -x proxy:1080 %h %p',
    usernameOptional: 'Username (optional)',
    passwordOptional: 'Password (optional)',
    keyImported: 'Key "%s" imported',
    importKeyFile: 'Import key file',
    noKeys: 'No keys yet. Generate a new Ed25519 key or import from ~/.ssh.',
    certHeader: 'Certificate',
    stored: 'saved',
    notSet: 'none',
    yes: 'yes',
    delete: 'Delete',
    deleteConfirm: 'Delete "%s"?',
    noIdentities: 'No identities yet.',
    loginWith: 'Logs in with',
    askOnConnect: 'ask on connect',
    noProxies: 'No proxies yet.',
    target: 'Target'
  }
}

function KeyDetails({ k, onClose }: { k: SshKey; onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const t = useT(S)
  const [fp, setFp] = useState('')
  useEffect(() => void api.keyFingerprint(k.id).then(setFp), [k.id])
  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text)
    toast(fmt(t.copied, what))
  }
  return (
    <Modal
      wide
      title={k.label}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          {t.close}
        </button>
      }
    >
      <Field label={t.fingerprint}>
        <div className="fp">{fp}</div>
      </Field>
      <VaultSelect
        value={k.teamId}
        onChange={(teamId) => {
          void api
            .upsert<SshKey>('keys', { ...k, teamId })
            .then(() => toast(teamId ? t.movedToTeam : t.movedToPrivate))
        }}
        hint={t.teamKeyHint}
      />
      <Field label={t.publicKey} hint={t.publicKeyHint}>
        <textarea className="textarea" readOnly value={k.publicKey} style={{ minHeight: 80 }} />
      </Field>
      <div className="row">
        <button className="btn" onClick={() => copy(k.publicKey, t.publicKey)}>
          {t.copyPublicKey}
        </button>
        <button
          className="btn"
          onClick={() =>
            copy(
              `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${k.publicKey.trim()}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
              t.command
            )
          }
        >
          {t.copyInstallCmd}
        </button>
      </div>
    </Modal>
  )
}

function NewKey({ onClose }: { onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const t = useT(S)
  const [mode, setMode] = useState<'generate' | 'paste'>('generate')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'ed25519' | 'rsa' | 'ecdsa'>('ed25519')
  const [pass, setPass] = useState('')
  const [priv, setPriv] = useState('')
  const [cert, setCert] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      if (mode === 'generate') await api.keyGenerate(label.trim(), kind, pass || undefined)
      else
        await api.keyImportText(
          label.trim(),
          priv.trim() + '\n',
          pass || undefined,
          cert.trim() || undefined
        )
      toast(t.keySaved)
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      wide
      title={t.newSshKey}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            disabled={busy || !label.trim() || (mode === 'paste' && !priv.trim())}
            onClick={submit}
          >
            {mode === 'generate' ? t.generateKey : t.save}
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className={'btn sm' + (mode === 'generate' ? ' on' : '')}
          onClick={() => setMode('generate')}
        >
          {t.generate}
        </button>
        <button
          className={'btn sm' + (mode === 'paste' ? ' on' : '')}
          onClick={() => setMode('paste')}
        >
          {t.pasteKey}
        </button>
      </div>
      <div className="grid-2">
        <Field label={t.name}>
          <input
            className="input"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t.namePh}
          />
        </Field>
        {mode === 'generate' ? (
          <Field label={t.type}>
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="ed25519">{t.ed25519Rec}</option>
              <option value="ecdsa">ECDSA P-256</option>
              <option value="rsa">RSA 4096</option>
            </select>
          </Field>
        ) : (
          <div />
        )}
      </div>
      {mode === 'paste' && (
        <>
          <Field label="Private key">
            <textarea
              className="textarea"
              value={priv}
              onChange={(e) => setPriv(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </Field>
          <Field label={t.certOptional} hint={t.certHint}>
            <textarea
              className="textarea"
              style={{ minHeight: 50 }}
              value={cert}
              onChange={(e) => setCert(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field label={t.passphraseOptional} hint={t.passHint}>
        <input
          className="input"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
      </Field>
    </Modal>
  )
}

function IdentityEditor({
  identity,
  onClose
}: {
  identity?: Identity
  onClose(): void
}): React.JSX.Element {
  const keys = useStore((s) => s.data?.keys ?? [])
  const t = useT(S)
  const [i, setI] = useState<Identity>(
    identity ?? { id: newId(), updatedAt: 0, label: '', username: '' }
  )
  return (
    <Modal
      title={identity ? t.editIdentity : t.newIdentity}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            disabled={!i.label.trim() || !i.username.trim()}
            onClick={async () => {
              await api.upsert('identities', i)
              onClose()
            }}
          >
            {t.save}
          </button>
        </>
      }
    >
      <p className="dim small" style={{ marginTop: 0 }}>
        {t.identityIntro}
      </p>
      <Field label={t.name}>
        <input
          className="input"
          autoFocus
          value={i.label}
          onChange={(e) => setI({ ...i, label: e.target.value })}
        />
      </Field>
      <VaultSelect value={i.teamId} onChange={(teamId) => setI({ ...i, teamId })} />
      <Field label="Username">
        <input
          className="input"
          value={i.username}
          onChange={(e) => setI({ ...i, username: e.target.value })}
        />
      </Field>
      <Field label="Password">
        <input
          className="input"
          type="password"
          value={i.password ?? ''}
          onChange={(e) => setI({ ...i, password: e.target.value || undefined })}
        />
      </Field>
      <Field label="SSH key">
        <select
          className="select"
          value={i.keyId ?? ''}
          onChange={(e) => setI({ ...i, keyId: e.target.value || undefined })}
        >
          <option value="">{t.none}</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  )
}

function ProxyEditor({ proxy, onClose }: { proxy?: ProxyDef; onClose(): void }): React.JSX.Element {
  const t = useT(S)
  const [p, setP] = useState<ProxyDef>(
    proxy ?? { id: newId(), updatedAt: 0, label: '', type: 'socks5', host: '127.0.0.1', port: 1080 }
  )
  return (
    <Modal
      title={proxy ? t.editProxy : t.newProxy}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            disabled={!p.label.trim()}
            onClick={async () => {
              await api.upsert('proxies', p)
              onClose()
            }}
          >
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
            value={p.label}
            onChange={(e) => setP({ ...p, label: e.target.value })}
          />
        </Field>
        <Field label={t.type}>
          <select
            className="select"
            value={p.type}
            onChange={(e) => setP({ ...p, type: e.target.value as ProxyDef['type'] })}
          >
            <option value="socks5">SOCKS5</option>
            <option value="socks4">SOCKS4</option>
            <option value="http">HTTP CONNECT</option>
            <option value="command">{t.proxyCommandOpt}</option>
          </select>
        </Field>
      </div>
      {p.type === 'command' ? (
        <Field label={t.command} hint={t.commandHint}>
          <input
            className="input mono"
            value={p.command ?? ''}
            onChange={(e) => setP({ ...p, command: e.target.value })}
          />
        </Field>
      ) : (
        <>
          <div className="grid-2">
            <Field label="Host">
              <input
                className="input"
                value={p.host}
                onChange={(e) => setP({ ...p, host: e.target.value })}
              />
            </Field>
            <Field label="Port">
              <input
                className="input"
                value={p.port}
                onChange={(e) => setP({ ...p, port: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          <div className="grid-2">
            <Field label={t.usernameOptional}>
              <input
                className="input"
                value={p.username ?? ''}
                onChange={(e) => setP({ ...p, username: e.target.value || undefined })}
              />
            </Field>
            <Field label={t.passwordOptional}>
              <input
                className="input"
                type="password"
                value={p.password ?? ''}
                onChange={(e) => setP({ ...p, password: e.target.value || undefined })}
              />
            </Field>
          </div>
        </>
      )}
    </Modal>
  )
}

export function KeychainView(): React.JSX.Element {
  const data = useStore((s) => s.data)!
  const toast = useStore((s) => s.toast)
  const t = useT(S)
  const [newKey, setNewKey] = useState(false)
  const [detail, setDetail] = useState<SshKey | null>(null)
  const [identity, setIdentity] = useState<{ v?: Identity } | null>(null)
  const [proxy, setProxy] = useState<{ v?: ProxyDef } | null>(null)

  const del = async (
    c: 'keys' | 'identities' | 'proxies',
    id: string,
    label: string
  ): Promise<void> => {
    if (
      await confirmDialog(t.delete, fmt(t.deleteConfirm, label), {
        danger: true,
        okLabel: t.delete
      })
    )
      await api.remove(c, id)
  }

  return (
    <div className="view">
      <div className="view-head">
        <h1>Keychain</h1>
        <span className="grow" />
        <button
          className="btn"
          onClick={async () => {
            try {
              const k = await api.keyImportFile()
              if (k) toast(fmt(t.keyImported, k.label))
            } catch (e) {
              toast(errMsg(e), 'error')
            }
          }}
        >
          {t.importKeyFile}
        </button>
        <button className="btn primary" onClick={() => setNewKey(true)}>
          {t.newSshKey}
        </button>
      </div>

      <div className="section-title">SSH key</div>
      {data.keys.length === 0 ? (
        <div className="dim small">{t.noKeys}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.type}</th>
              <th>Passphrase</th>
              <th>{t.certHeader}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.keys.map((k) => (
              <tr key={k.id}>
                <td className="cell-title">{k.label}</td>
                <td className="mono small">{k.keyType}</td>
                <td className="muted">{k.passphrase ? t.stored : t.notSet}</td>
                <td className="muted">{k.certificate ? t.yes : ''}</td>
                <td className="actions">
                  <button className="btn sm" onClick={() => setDetail(k)}>
                    {t.publicKey}
                  </button>
                  <button
                    className="btn sm ghost danger"
                    onClick={() => del('keys', k.id, k.label)}
                  >
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row">
        <div className="section-title grow">Identity</div>
        <button className="btn sm" onClick={() => setIdentity({})}>
          {t.newIdentity}
        </button>
      </div>
      {data.identities.length === 0 ? (
        <div className="dim small">{t.noIdentities}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>Username</th>
              <th>{t.loginWith}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.identities.map((i) => (
              <tr key={i.id}>
                <td className="cell-title">{i.label}</td>
                <td className="mono small">{i.username}</td>
                <td className="muted">
                  {[i.password && 'password', i.keyId && 'key'].filter(Boolean).join(' + ') ||
                    t.askOnConnect}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => setIdentity({ v: i })}>
                    Edit
                  </button>
                  <button
                    className="btn sm ghost danger"
                    onClick={() => del('identities', i.id, i.label)}
                  >
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row">
        <div className="section-title grow">Proxy</div>
        <button className="btn sm" onClick={() => setProxy({})}>
          {t.newProxy}
        </button>
      </div>
      {data.proxies.length === 0 ? (
        <div className="dim small">{t.noProxies}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.type}</th>
              <th>{t.target}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.proxies.map((p) => (
              <tr key={p.id}>
                <td className="cell-title">{p.label}</td>
                <td className="muted">{p.type}</td>
                <td className="mono small ellipsis" style={{ maxWidth: 360 }}>
                  {p.type === 'command' ? p.command : `${p.host}:${p.port}`}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => setProxy({ v: p })}>
                    Edit
                  </button>
                  <button
                    className="btn sm ghost danger"
                    onClick={() => del('proxies', p.id, p.label)}
                  >
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {newKey && <NewKey onClose={() => setNewKey(false)} />}
      {detail && <KeyDetails k={detail} onClose={() => setDetail(null)} />}
      {identity && <IdentityEditor identity={identity.v} onClose={() => setIdentity(null)} />}
      {proxy && <ProxyEditor proxy={proxy.v} onClose={() => setProxy(null)} />}
    </div>
  )
}
