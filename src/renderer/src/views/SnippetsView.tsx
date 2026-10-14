import { useState } from 'react'
import { newId } from '../../../shared/merge'
import type { Snippet } from '../../../shared/types'
import { api } from '../api'
import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Field, Modal } from '../components/ui'
import { VaultSelect } from '../components/VaultSelect'
import { confirmDialog } from '../lib'

const S = {
  id: {
    editSnippet: 'Edit snippet',
    newSnippet: 'Snippet baru',
    cancel: 'Batal',
    save: 'Simpan',
    name: 'Nama',
    namePh: 'Cek disk',
    teamHint: 'Snippet di tim bisa dijalankan semua anggota.',
    command: 'Perintah',
    commandHint: 'Tiap baris dikirim sebagai perintah terpisah.',
    intro:
      'Perintah yang sering dipakai. Jalankan lewat tombol Snippet di tab terminal, atau pasang sebagai snippet saat login di pengaturan host.',
    empty:
      'Belum ada snippet. Simpan perintah yang sering kamu ketik, misalnya cek disk atau restart service.',
    deleteTitle: 'Hapus snippet',
    delete: 'Hapus',
    deleteConfirm: 'Hapus "%s"?'
  },
  en: {
    editSnippet: 'Edit snippet',
    newSnippet: 'New snippet',
    cancel: 'Cancel',
    save: 'Save',
    name: 'Name',
    namePh: 'Check disk',
    teamHint: 'Team snippets can be run by every team member.',
    command: 'Command',
    commandHint: 'Each line is sent as a separate command.',
    intro:
      'Frequently used commands. Run them with the Snippet button in a terminal tab, or install as a login snippet in the host settings.',
    empty:
      'No snippets yet. Save the commands you type often, like checking disk or restarting a service.',
    deleteTitle: 'Delete snippet',
    delete: 'Delete',
    deleteConfirm: 'Delete "%s"?'
  }
}

function SnippetEditor({
  snippet,
  onClose
}: {
  snippet?: Snippet
  onClose(): void
}): React.JSX.Element {
  const t = useT(S)
  const [s, setS] = useState<Snippet>(
    snippet ?? { id: newId(), updatedAt: 0, label: '', script: '' }
  )
  return (
    <Modal
      wide
      title={snippet ? t.editSnippet : t.newSnippet}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            disabled={!s.label.trim() || !s.script.trim()}
            onClick={async () => {
              await api.upsert('snippets', s)
              onClose()
            }}
          >
            {t.save}
          </button>
        </>
      }
    >
      <Field label={t.name}>
        <input
          className="input"
          autoFocus
          value={s.label}
          onChange={(e) => setS({ ...s, label: e.target.value })}
          placeholder={t.namePh}
        />
      </Field>
      <VaultSelect
        value={s.teamId}
        onChange={(teamId) => setS({ ...s, teamId })}
        hint={t.teamHint}
      />
      <Field label={t.command} hint={t.commandHint}>
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
  const t = useT(S)
  const [editing, setEditing] = useState<{ v?: Snippet } | null>(null)
  return (
    <div className="view">
      <div className="view-head">
        <h1>Snippets</h1>
        <span className="grow" />
        <button className="btn primary" onClick={() => setEditing({})}>
          {t.newSnippet}
        </button>
      </div>
      <p className="view-intro">{t.intro}</p>
      {snippets.length === 0 ? (
        <div className="empty">
          <p>{t.empty}</p>
          <button className="btn" onClick={() => setEditing({})}>
            {t.newSnippet}
          </button>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.command}</th>
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
                        await confirmDialog(t.deleteTitle, fmt(t.deleteConfirm, s.label), {
                          danger: true,
                          okLabel: t.delete
                        })
                      )
                        await api.remove('snippets', s.id)
                    }}
                  >
                    {t.delete}
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
