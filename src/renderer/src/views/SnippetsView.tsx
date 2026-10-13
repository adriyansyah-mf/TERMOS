import { useState } from 'react'
import { newId } from '../../../shared/merge'
import type { Snippet } from '../../../shared/types'
import { api } from '../api'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { confirmDialog } from '../lib'

function SnippetEditor({
  snippet,
  onClose
}: {
  snippet?: Snippet
  onClose(): void
}): React.JSX.Element {
  const [s, setS] = useState<Snippet>(
    snippet ?? { id: newId(), updatedAt: 0, label: '', script: '' }
  )
  return (
    <Modal
      wide
      title={snippet ? 'Edit snippet' : 'Snippet baru'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={!s.label.trim() || !s.script.trim()}
            onClick={async () => {
              await api.upsert('snippets', s)
              onClose()
            }}
          >
            Simpan
          </button>
        </>
      }
    >
      <Field label="Nama">
        <input
          className="input"
          autoFocus
          value={s.label}
          onChange={(e) => setS({ ...s, label: e.target.value })}
          placeholder="Cek disk"
        />
      </Field>
      <Field label="Perintah" hint="Tiap baris dikirim sebagai perintah terpisah.">
        <textarea
          className="textarea"
          style={{ minHeight: 160 }}
          spellCheck={false}
          value={s.script}
          onChange={(e) => setS({ ...s, script: e.target.value })}
          placeholder={'df -h\nfree -m'}
        />
      </Field>
    </Modal>
  )
}

export function SnippetsView(): React.JSX.Element {
  const snippets = useStore((s) => s.data?.snippets ?? [])
  const [editing, setEditing] = useState<{ v?: Snippet } | null>(null)
  return (
    <div className="view">
      <div className="view-head">
        <h1>Snippets</h1>
        <span className="grow" />
        <button className="btn primary" onClick={() => setEditing({})}>
          + Snippet
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>
        Perintah yang sering dipakai. Jalankan dari tombol ⚡ Snippet di tab terminal, atau pasang
        sebagai snippet saat login di pengaturan host.
      </p>
      {snippets.length === 0 ? (
        <div className="empty">
          <div className="big">⚡</div>
          Belum ada snippet.
        </div>
      ) : (
        <div className="list">
          {snippets.map((s) => (
            <div key={s.id} className="list-row">
              <div className="grow ellipsis">
                <div className="title">{s.label}</div>
                <div className="dim small mono ellipsis">{s.script.replace(/\n/g, ' ⏎ ')}</div>
              </div>
              <button className="btn sm" onClick={() => setEditing({ v: s })}>
                Edit
              </button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (
                    await confirmDialog('Hapus snippet', `Hapus "${s.label}"?`, {
                      danger: true,
                      okLabel: 'Hapus'
                    })
                  )
                    await api.remove('snippets', s.id)
                }}
              >
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && <SnippetEditor snippet={editing.v} onClose={() => setEditing(null)} />}
    </div>
  )
}
