import { create } from 'zustand'
import type { VaultStatus } from '../../shared/api'
import type { OpenSessionRequest, SessionEvent, SessionTarget, VaultData } from '../../shared/types'
import { api, bridge, errMsg } from './api'

export type View =
  'hosts' | 'keychain' | 'snippets' | 'forwards' | 'proxmox' | 'knownHosts' | 'history' | 'settings'

export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface Pane {
  sessionId: string
  label: string
  hostId?: string
  target: SessionTarget
  status: SessionStatus
  message?: string
}

export interface Tab {
  id: string
  panes: Pane[]
  /** Index of the pane that receives snippets / keyboard focus. */
  focused: number
  sftp?: { hostId: string }
}

export type PendingRequest = Extract<SessionEvent, { requestId: string }>

export interface Toast {
  id: number
  kind: 'info' | 'error'
  text: string
}

interface State {
  status: VaultStatus | null
  data: VaultData | null
  view: View
  tabs: Tab[]
  /** null means the home (vault) screen is shown. */
  activeTab: string | null
  requests: PendingRequest[]
  toasts: Toast[]

  refreshStatus(): Promise<void>
  refreshData(): Promise<void>
  setView(v: View): void
  openSession(target: SessionTarget, opts?: { tabId?: string; label?: string }): Promise<void>
  closePane(tabId: string, sessionId: string): void
  closeTab(tabId: string): void
  reconnect(tabId: string, sessionId: string): Promise<void>
  setActiveTab(id: string | null): void
  focusPane(tabId: string, index: number): void
  toggleSftp(tabId: string): void
  answer(requestId: string, value: unknown): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
}

let toastSeq = 0
/** Status events can beat sessionOpen's reply; keep the latest one per session. */
const lastStatus = new Map<string, { status: SessionStatus; message?: string }>()
const DEFAULT_SIZE = { cols: 100, rows: 30 }

export const useStore = create<State>((set, get) => ({
  status: null,
  data: null,
  view: 'hosts',
  tabs: [],
  activeTab: null,
  requests: [],
  toasts: [],

  refreshStatus: async () => {
    const status = await api.vaultStatus()
    set({ status })
    if (status.unlocked) await get().refreshData()
    else set({ data: null, tabs: [], activeTab: null })
  },

  refreshData: async () => {
    try {
      set({ data: await api.vaultSnapshot() })
    } catch {
      /* vault locked meanwhile */
    }
  },

  setView: (view) => set({ view, activeTab: null }),

  openSession: async (target, opts) => {
    try {
      const req: OpenSessionRequest = { target, ...DEFAULT_SIZE }
      const { sessionId, label } = await api.sessionOpen(req)
      const pane: Pane = {
        sessionId,
        label: opts?.label ?? label,
        hostId: target.kind === 'host' ? target.hostId : undefined,
        target,
        status: 'connecting',
        ...lastStatus.get(sessionId)
      }
      set((s) => {
        if (opts?.tabId) {
          const tabs = s.tabs.map((t) =>
            t.id === opts.tabId ? { ...t, panes: [...t.panes, pane], focused: t.panes.length } : t
          )
          return { tabs, activeTab: opts.tabId }
        }
        const tab: Tab = { id: sessionId, panes: [pane], focused: 0 }
        return { tabs: [...s.tabs, tab], activeTab: tab.id }
      })
    } catch (err) {
      get().toast(errMsg(err), 'error')
    }
  },

  closePane: (tabId, sessionId) => {
    void api.sessionClose(sessionId)
    set((s) => {
      const tabs = s.tabs
        .map((t) =>
          t.id === tabId
            ? {
                ...t,
                panes: t.panes.filter((p) => p.sessionId !== sessionId),
                focused: 0
              }
            : t
        )
        .filter((t) => t.panes.length > 0)
      const activeTab = tabs.some((t) => t.id === s.activeTab)
        ? s.activeTab
        : (tabs.at(-1)?.id ?? null)
      return { tabs, activeTab }
    })
  },

  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    for (const p of tab?.panes ?? []) void api.sessionClose(p.sessionId)
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === tabId)
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      const activeTab = s.activeTab === tabId ? (tabs[Math.max(0, i - 1)]?.id ?? null) : s.activeTab
      return { tabs, activeTab }
    })
  },

  reconnect: async (tabId, sessionId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    const pane = tab?.panes.find((p) => p.sessionId === sessionId)
    if (!tab || !pane) return
    void api.sessionClose(sessionId)
    try {
      const { sessionId: newId } = await api.sessionOpen({ target: pane.target, ...DEFAULT_SIZE })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                panes: t.panes.map((p) =>
                  p.sessionId === sessionId
                    ? {
                        ...p,
                        sessionId: newId,
                        status: 'connecting',
                        message: undefined,
                        ...lastStatus.get(newId)
                      }
                    : p
                )
              }
            : t
        )
      }))
    } catch (err) {
      get().toast(errMsg(err), 'error')
    }
  },

  setActiveTab: (id) => set({ activeTab: id }),
  focusPane: (tabId, index) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, focused: index } : t)) })),

  toggleSftp: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        if (t.sftp) return { ...t, sftp: undefined }
        const hostId = t.panes[t.focused]?.hostId ?? t.panes.find((p) => p.hostId)?.hostId
        return hostId ? { ...t, sftp: { hostId } } : t
      })
    })),

  answer: (requestId, value) => {
    void api.sessionAnswer(requestId, value)
    set((s) => ({ requests: s.requests.filter((r) => r.requestId !== requestId) }))
  },

  toast: (text, kind = 'info') => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Session output listeners keyed by session id (terminals subscribe on mount). */
const outputListeners = new Map<string, (data: string) => void>()
/** Output that arrived before the terminal mounted. */
const earlyOutput = new Map<string, string>()

export function subscribeOutput(sessionId: string, fn: (data: string) => void): () => void {
  outputListeners.set(sessionId, fn)
  const early = earlyOutput.get(sessionId)
  if (early) {
    earlyOutput.delete(sessionId)
    fn(early)
  }
  return () => {
    if (outputListeners.get(sessionId) === fn) outputListeners.delete(sessionId)
  }
}

export function initEvents(): void {
  const { getState, setState } = useStore
  bridge.on('session:event', (ev) => {
    if (ev.type === 'data') {
      const fn = outputListeners.get(ev.sessionId)
      if (fn) fn(ev.data)
      else earlyOutput.set(ev.sessionId, (earlyOutput.get(ev.sessionId) ?? '') + ev.data)
      return
    }
    if (ev.type === 'status') {
      lastStatus.set(ev.sessionId, { status: ev.status, message: ev.message })
      setState((s) => ({
        tabs: s.tabs.map((t) => ({
          ...t,
          panes: t.panes.map((p) =>
            p.sessionId === ev.sessionId ? { ...p, status: ev.status, message: ev.message } : p
          )
        }))
      }))
      return
    }
    // Host-key and keyboard-interactive prompts queue up and show one at a time.
    setState((s) => ({ requests: [...s.requests, ev] }))
  })
  bridge.on('vault:changed', () => void getState().refreshData())
  bridge.on('vault:locked', () => void getState().refreshStatus())
}
