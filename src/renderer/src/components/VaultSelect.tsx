import { fmt, useT } from '../i18n'
import { useStore } from '../store'
import { Field } from './ui'

const S = {
  id: {
    label: 'Disimpan di',
    hint: 'Item di tim tersinkron ke semua anggota tim. Key dan identity yang dipakai juga perlu ada di tim yang sama.',
    personal: 'Vault pribadi',
    team: 'Tim %s',
    unavailable: '(tim tidak tersedia)'
  },
  en: {
    label: 'Stored in',
    hint: 'Team items sync to every team member. The keys and identities they use must also be in the same team.',
    personal: 'Personal vault',
    team: 'Team %s',
    unavailable: '(team unavailable)'
  }
}

/** "Disimpan di": personal vault or one of the teams this account belongs to. Hidden without teams. */
export function VaultSelect(props: {
  value?: string
  onChange(teamId: string | undefined): void
  hint?: string
}): React.JSX.Element | null {
  const t = useT(S)
  const teams = useStore((s) => s.data?.teams ?? [])
  if (!teams.length && !props.value) return null
  return (
    <Field label={t.label} hint={props.hint ?? t.hint}>
      <select
        className="select"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value || undefined)}
      >
        <option value="">{t.personal}</option>
        {teams.map((tm) => (
          <option key={tm.id} value={tm.id}>
            {fmt(t.team, tm.label)}
          </option>
        ))}
        {props.value && !teams.some((tm) => tm.id === props.value) && (
          <option value={props.value}>{t.unavailable}</option>
        )}
      </select>
    </Field>
  )
}
