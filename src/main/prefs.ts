import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Language } from '../shared/types'
import { setLanguage } from './i18n'

/**
 * The UI language lives in a plaintext prefs.json next to the vault folder — it
 * is not a secret, and the lock screen needs it before the vault can be opened.
 */

let loaded = false

function prefsFile(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

/** Apply the stored language to the i18n state; read at most once per run. */
export function loadLanguage(): void {
  if (loaded) return
  loaded = true
  try {
    if (!existsSync(prefsFile())) return
    const raw = JSON.parse(readFileSync(prefsFile(), 'utf8').replace(/^\uFEFF/, ''))
    if (raw?.language === 'id' || raw?.language === 'en') setLanguage(raw.language)
  } catch {
    /* unreadable prefs: keep the default language */
  }
}

/** Switch the language in memory and persist it for the next launch. */
export function persistLanguage(lang: Language): void {
  setLanguage(lang)
  try {
    writeFileSync(prefsFile(), JSON.stringify({ language: lang }), { mode: 0o600 })
  } catch {
    /* prefs are cosmetic; never fail a settings save over them */
  }
}
