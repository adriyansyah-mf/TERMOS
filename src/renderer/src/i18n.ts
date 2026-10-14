import { useStore } from './store'

/**
 * Per-file message tables. Each view/component declares its own table so
 * translations stay next to the code that uses them:
 *
 *   const S = { id: { save: 'Simpan' }, en: { save: 'Save' } }
 *   const t = useT(S)   // re-renders when the language changes
 *   fmt(t.savedN, String(n))  // '%s item disimpan'
 */

export type UIStrings = { id: Record<string, string>; en: Record<string, string> }

export function useT<S extends Record<string, string>>(dict: { id: S; en: S }): S {
  const lang = useStore((s) => s.lang)
  return (dict[lang] ?? dict.id) as S
}

/** Substitute %s placeholders: fmt('%s host baru', String(n)). */
export function fmt(template: string, ...values: string[]): string {
  let i = 0
  return template.replace(/%s/g, () => values[i++] ?? '')
}
