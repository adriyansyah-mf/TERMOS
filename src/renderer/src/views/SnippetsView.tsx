import { useState } from 'react'
import { newId } from '../../../shared/merge'
import type { Snippet } from '../../../shared/types'
import { api } from '../api'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { VaultSelect } from '../components/VaultSelect'
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
      <VaultSelect
        value={s.teamId}
        onChange={(teamId) => setS({ ...s, teamId })}
        hint="Snippet di tim bisa dijalankan semua anggota."
      />
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
          Snippet baru
        </button>
      </div>
      <p className="view-intro">
        Perintah yang sering dipakai. Jalankan lewat tombol Snippet di tab terminal, atau pasang
        sebagai snippet saat login di pengaturan host.
      </p>
      {snippets.length === 0 ? (
        <div className="empty">
          <p>
            Belum ada snippet. Simpan perintah yang sering kamu ketik, misalnya cek disk atau
            restart service.
          </p>
          <button className="btn" onClick={() => setEditing({})}>
            Snippet baru
          </button>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Perintah</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {snippets.map((s) => (
              <tr key={s.id}>
                <td className="cell-title">{s.label}</td>
                <td className="mono small ellipsis" style={{ maxWidth: 520 }}>
                  {s.script.replace(/\n/g, ' ; ')}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => setEditing({ v: s })}>
                    Edit
                  </button>
                  <button
                    className="btn sm ghost danger"
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <SnippetEditor snippet={editing.v} onClose={() => setEditing(null)} />}
    </div>
  )
}
