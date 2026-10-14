import type { Language } from '../shared/types'

/**
 * Pure language state + message helpers. No Electron imports here: main modules
 * such as crypto.ts are also bundled into the plain-Node test suite.
 */

let current: Language = 'id'

/** Applied by prefs.ts when prefs.json is read or the user switches language. */
export function setLanguage(lang: Language): void {
  current = lang
}

export function getLanguage(): Language {
  return current
}

export type L10n<S extends Record<string, string>> = { id: S; en: S }

/** Message table for the current language; used for user-facing main-process errors. */
export function tr<S extends Record<string, string>>(dict: L10n<S>): S {
  return dict[current] ?? dict.id
}

/** Substitute %s placeholders: fmt('%s host baru', String(n)). */
export function fmt(template: string, ...values: string[]): string {
  let i = 0
  return template.replace(/%s/g, () => values[i++] ?? '')
}
