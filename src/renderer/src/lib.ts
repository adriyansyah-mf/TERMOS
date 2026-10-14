import type { ReactNode } from 'react'
import { create } from 'zustand'
import { fmt } from './i18n'
import { useStore } from './store'

const S = {
  id: {
    justNow: 'baru saja',
    minutesAgo: '%s menit lalu',
    hoursAgo: '%s jam lalu',
    daysAgo: '%s hari lalu'
  },
  en: {
    justNow: 'just now',
    minutesAgo: '%s minutes ago',
    hoursAgo: '%s hours ago',
    daysAgo: '%s days ago'
  }
}

export function formatBytes(n?: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}

export function timeAgo(ms?: number): string {
  if (!ms) return '-'
  const s = Math.floor((Date.now() - ms) / 1000)
  const t = S[useStore.getState().lang]
  if (s < 60) return t.justNow
  if (s < 3600) return fmt(t.minutesAgo, String(Math.floor(s / 60)))
  if (s < 86400) return fmt(t.hoursAgo, String(Math.floor(s / 3600)))
  return fmt(t.daysAgo, String(Math.floor(s / 86400)))
}

interface DialogField {
  key: string
  label: string
  value?: string
  type?: 'text' | 'password'
  placeholder?: string
}

export type DialogReq =
  | {
      kind: 'confirm'
      title: string
      message: ReactNode
      danger?: boolean
      okLabel?: string
      resolve: (v: boolean) => void
    }
  | {
      kind: 'prompt'
      title: string
      fields: DialogField[]
      okLabel?: string
      resolve: (v: Record<string, string> | null) => void
    }

export const useDialogs = create<{ stack: DialogReq[] }>(() => ({ stack: [] }))
const push = (d: DialogReq): void => useDialogs.setState((s) => ({ stack: [...s.stack, d] }))
export const pop = (d: DialogReq): void =>
  useDialogs.setState((s) => ({ stack: s.stack.filter((x) => x !== d) }))

export function confirmDialog(
  title: string,
  message: ReactNode,
  opts?: { danger?: boolean; okLabel?: string }
): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', title, message, ...opts, resolve }))
}

export function promptDialog(
  title: string,
  fields: DialogField[],
  okLabel?: string
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => push({ kind: 'prompt', title, fields, okLabel, resolve }))
}

export async function promptOne(title: string, label: string, value = ''): Promise<string | null> {
  const r = await promptDialog(title, [{ key: 'v', label, value }])
  return r ? r.v : null
}
