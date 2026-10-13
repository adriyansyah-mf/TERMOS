import { useEffect, useState } from 'react'
import { newId } from '../../../shared/merge'
import type { Identity, ProxyDef, SshKey } from '../../../shared/types'
import { api, errMsg } from '../api'
import { useStore } from '../store'
import { Avatar, Field, Modal } from '../components/ui'
import { confirmDialog } from '../lib'

function KeyDetails({ k, onClose }: { k: SshKey; onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const [fp, setFp] = useState('')
  useEffect(() => void api.keyFingerprint(k.id).then(setFp), [k.id])
  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text)
    toast(`${what} disalin`)
  }
  return (
    <Modal
      wide
      title={k.label}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <Field label="Fingerprint">
        <div className="fp">{fp}</div>
      </Field>
      <Field
        label="Public key"
        hint="Tempel ke ~/.ssh/authorized_keys di server, atau pakai ssh-copy-id."
      >
        <textarea className="textarea" readOnly value={k.publicKey} style={{ minHeight: 80 }} />
      </Field>
      <div className="row">
        <button className="btn" onClick={() => copy(k.publicKey, 'Public key')}>
          Salin public key
        </button>
        <button
          className="btn"
          onClick={() =>
            copy(
              `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${k.publicKey.trim()}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
              'Perintah'
            )
          }
        >
          Salin perintah pasang ke server
        </button>
      </div>
    </Modal>
  )
}

function NewKey({ onClose }: { onClose(): void }): React.JSX.Element {
  const toast = useStore((s) => s.toast)
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
      toast('Key disimpan')
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
      title="SSH key baru"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={busy || !label.trim() || (mode === 'paste' && !priv.trim())}
            onClick={submit}
          >
            {mode === 'generate' ? 'Buat key' : 'Simpan'}
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className={'btn sm' + (mode === 'generate' ? ' primary' : '')}
          onClick={() => setMode('generate')}
        >
          Buat baru
        </button>
        <button
          className={'btn sm' + (mode === 'paste' ? ' primary' : '')}
          onClick={() => setMode('paste')}
        >
          Tempel private key
        </button>
      </div>
      <div className="grid-2">
        <Field label="Nama">
          <input
            className="input"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="laptop-kantor"
          />
        </Field>
        {mode === 'generate' ? (
          <Field label="Tipe">
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="ed25519">Ed25519 (disarankan)</option>
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
          <Field
            label="Sertifikat (opsional)"
            hint="Isi *-cert.pub kalau server memakai SSH certificate. Gunakan engine OpenSSH untuk host-nya."
          >
            <textarea
              className="textarea"
              style={{ minHeight: 50 }}
              value={cert}
              onChange={(e) => setCert(e.target.value)}
            />
          </Field>
        </>
      )}
      <Field
        label="Passphrase (opsional)"
        hint="Disimpan terenkripsi di vault, jadi tidak ditanya tiap konek."
      >
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
  const [i, setI] = useState<Identity>(
    identity ?? { id: newId(), updatedAt: 0, label: '', username: '' }
  )
  return (
    <Modal
      title={identity ? 'Edit identity' : 'Identity baru'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!i.label.trim() || !i.username.trim()}
            onClick={async () => {
              await api.upsert('identities', i)
              onClose()
            }}
          >
            Simpan
          </button>
        </>
      }
    >
      <p className="dim small" style={{ marginTop: 0 }}>
        Identity = username + password/key yang bisa dipakai banyak host sekaligus.
      </p>
      <Field label="Nama">
        <input
          className="input"
          autoFocus
          value={i.label}
          onChange={(e) => setI({ ...i, label: e.target.value })}
        />
      </Field>
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
          <option value="">— tidak ada —</option>
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
  const [p, setP] = useState<ProxyDef>(
    proxy ?? { id: newId(), updatedAt: 0, label: '', type: 'socks5', host: '127.0.0.1', port: 1080 }
  )
  return (
    <Modal
      title={proxy ? 'Edit proxy' : 'Proxy baru'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!p.label.trim()}
            onClick={async () => {
              await api.upsert('proxies', p)
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
            value={p.label}
            onChange={(e) => setP({ ...p, label: e.target.value })}
          />
        </Field>
        <Field label="Tipe">
          <select
            className="select"
            value={p.type}
            onChange={(e) => setP({ ...p, type: e.target.value as ProxyDef['type'] })}
          >
            <option value="socks5">SOCKS5</option>
            <option value="socks4">SOCKS4</option>
            <option value="http">HTTP CONNECT</option>
            <option value="command">Perintah (ProxyCommand)</option>
          </select>
        </Field>
      </div>
      {p.type === 'command' ? (
        <Field
          label="Perintah"
          hint="%h = host tujuan, %p = port, %r = user. Contoh: nc -X 5 -x proxy:1080 %h %p"
        >
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
            <Field label="Username (opsional)">
              <input
                className="input"
                value={p.username ?? ''}
                onChange={(e) => setP({ ...p, username: e.target.value || undefined })}
              />
            </Field>
            <Field label="Password (opsional)">
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
  const [newKey, setNewKey] = useState(false)
  const [detail, setDetail] = useState<SshKey | null>(null)
  const [identity, setIdentity] = useState<{ v?: Identity } | null>(null)
  const [proxy, setProxy] = useState<{ v?: ProxyDef } | null>(null)

  const del = async (
    c: 'keys' | 'identities' | 'proxies',
    id: string,
    label: string
  ): Promise<void> => {
    if (await confirmDialog('Hapus', `Hapus "${label}"?`, { danger: true, okLabel: 'Hapus' }))
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
              if (k) toast(`Key "${k.label}" diimpor`)
            } catch (e) {
              toast(errMsg(e), 'error')
            }
          }}
        >
          Import file key
        </button>
        <button className="btn primary" onClick={() => setNewKey(true)}>
          + SSH key
        </button>
      </div>

      <div className="section-title">SSH key</div>
      {data.keys.length === 0 ? (
        <div className="dim small">
          Belum ada key. Buat key Ed25519 baru atau import dari ~/.ssh.
        </div>
      ) : (
        <div className="list">
          {data.keys.map((k) => (
            <div key={k.id} className="list-row">
              <Avatar text={k.label} icon="🔑" />
              <div
                className="ellipsis grow"
                style={{ cursor: 'pointer' }}
                onClick={() => setDetail(k)}
              >
                <div className="title">{k.label}</div>
                <div className="dim small">
                  {k.keyType}
                  {k.passphrase ? ' · berpassphrase' : ''}
                  {k.certificate ? ' · sertifikat' : ''}
                </div>
              </div>
              <button className="btn sm" onClick={() => setDetail(k)}>
                Public key
              </button>
              <button className="btn sm danger" onClick={() => del('keys', k.id, k.label)}>
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <div className="section-title grow">Identity</div>
        <button className="btn sm" onClick={() => setIdentity({})}>
          + Identity
        </button>
      </div>
      {data.identities.length === 0 ? (
        <div className="dim small">Belum ada identity.</div>
      ) : (
        <div className="list">
          {data.identities.map((i) => (
            <div key={i.id} className="list-row">
              <Avatar text={i.label} icon="👤" />
              <div className="grow ellipsis">
                <div className="title">{i.label}</div>
                <div className="dim small">
                  {i.username}
                  {i.password ? ' · password' : ''}
                  {i.keyId ? ' · key' : ''}
                </div>
              </div>
              <button className="btn sm" onClick={() => setIdentity({ v: i })}>
                Edit
              </button>
              <button className="btn sm danger" onClick={() => del('identities', i.id, i.label)}>
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <div className="section-title grow">Proxy</div>
        <button className="btn sm" onClick={() => setProxy({})}>
          + Proxy
        </button>
      </div>
      {data.proxies.length === 0 ? (
        <div className="dim small">Belum ada proxy.</div>
      ) : (
        <div className="list">
          {data.proxies.map((p) => (
            <div key={p.id} className="list-row">
              <Avatar text={p.label} icon="⇄" />
              <div className="grow ellipsis">
                <div className="title">{p.label}</div>
                <div className="dim small">
                  {p.type} · {p.type === 'command' ? p.command : `${p.host}:${p.port}`}
                </div>
              </div>
              <button className="btn sm" onClick={() => setProxy({ v: p })}>
                Edit
              </button>
              <button className="btn sm danger" onClick={() => del('proxies', p.id, p.label)}>
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}

      {newKey && <NewKey onClose={() => setNewKey(false)} />}
      {detail && <KeyDetails k={detail} onClose={() => setDetail(null)} />}
      {identity && <IdentityEditor identity={identity.v} onClose={() => setIdentity(null)} />}
      {proxy && <ProxyEditor proxy={proxy.v} onClose={() => setProxy(null)} />}
    </div>
  )
}
