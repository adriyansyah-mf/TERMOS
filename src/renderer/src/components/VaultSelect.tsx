import { useStore } from '../store'
import { Field } from './ui'

/** "Disimpan di": personal vault or one of the teams this account belongs to. Hidden without teams. */
export function VaultSelect(props: {
  value?: string
  onChange(teamId: string | undefined): void
  hint?: string
}): React.JSX.Element | null {
  const teams = useStore((s) => s.data?.teams ?? [])
  if (!teams.length && !props.value) return null
  return (
    <Field
      label="Disimpan di"
      hint={
        props.hint ??
        'Item di tim tersinkron ke semua anggota tim. Key dan identity yang dipakai juga perlu ada di tim yang sama.'
      }
    >
      <select
        className="select"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value || undefined)}
      >
        <option value="">Vault pribadi</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            Tim {t.label}
          </option>
        ))}
        {props.value && !teams.some((t) => t.id === props.value) && (
          <option value={props.value}>(tim tidak tersedia)</option>
        )}
      </select>
    </Field>
  )
}
