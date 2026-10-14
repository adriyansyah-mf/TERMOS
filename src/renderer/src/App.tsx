import { useEffect, useState } from 'react'
import { useStore, type View } from './store'
import { fmt, useT } from './i18n'
import { LockScreen } from './components/LockScreen'
import { SessionRequests, Toasts } from './components/SessionRequests'
import { TermTab } from './components/TermTab'
import { HostPicker } from './components/HostPicker'
import { DialogHost } from './components/ui'
import { HostsView } from './views/HostsView'
import { KeychainView } from './views/KeychainView'
import { SnippetsView } from './views/SnippetsView'
import { ForwardsView } from './views/ForwardsView'
import { ProxmoxView } from './views/ProxmoxView'
import { HistoryView, KnownHostsView, SettingsView } from './views/SmallViews'
import { SyncView } from './views/SyncView'

const S = {
  id: {
    hosts: 'Hosts',
    keychain: 'Keychain',
    snippets: 'Snippets',
    forwards: 'Port forwarding',
    proxmox: 'Proxmox',
    knownHosts: 'Known hosts',
    history: 'Riwayat',
    sync: 'Sync & tim',
    settings: 'Settings',
    menu: 'Menu',
    local: 'Lokal',
    closeTab: 'Tutup %s',
    closeTabHint: 'Tutup (Ctrl+Shift+W)',
    newSession: 'Sesi baru',
    newSessionHint: 'Sesi baru (Ctrl+K)',
    quickConnect: 'Quick connect'
  },
  en: {
    hosts: 'Hosts',
    keychain: 'Keychain',
    snippets: 'Snippets',
    forwards: 'Port forwarding',
    proxmox: 'Proxmox',
    knownHosts: 'Known hosts',
    history: 'History',
    sync: 'Sync & teams',
    settings: 'Settings',
    menu: 'Menu',
    local: 'Local',
    closeTab: 'Close %s',
    closeTabHint: 'Close (Ctrl+Shift+W)',
    newSession: 'New session',
    newSessionHint: 'New session (Ctrl+K)',
    quickConnect: 'Quick connect'
  }
}

// Order matters: Ctrl+1..9 follows this list.
const NAV: View[] = [
  'hosts',
  'keychain',
  'snippets',
  'forwards',
  'proxmox',
  'knownHosts',
  'history',
  'sync',
  'settings'
]

function CurrentView({ view }: { view: View }): React.JSX.Element {
  switch (view) {
    case 'keychain':
      return <KeychainView />
    case 'snippets':
      return <SnippetsView />
    case 'forwards':
      return <ForwardsView />
    case 'proxmox':
      return <ProxmoxView />
    case 'knownHosts':
      return <KnownHostsView />
    case 'history':
      return <HistoryView />
    case 'sync':
      return <SyncView />
    case 'settings':
      return <SettingsView />
    default:
      return <HostsView />
  }
}

function NavButton({ item, index }: { item: View; index: number }): React.JSX.Element {
  const t = useT(S)
  const active = useStore((s) => s.activeTab === null && s.view === item)
  return (
    <button
      className={'nav-item' + (active ? ' active' : '')}
      aria-current={active ? 'page' : undefined}
      onClick={() => useStore.getState().setView(item)}
    >
      {t[item]}
      <kbd>Ctrl {index + 1}</kbd>
    </button>
  )
}

function Workspace(): React.JSX.Element {
  const t = useT(S)
  const view = useStore((s) => s.view)
  const tabs = useStore((s) => s.tabs)
  const activeTab = useStore((s) => s.activeTab)
  const { setView, setActiveTab, closeTab, openSession } = useStore.getState()
  const [quick, setQuick] = useState(false)
  const viewLabel = t[view]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { tabs, activeTab } = useStore.getState()
      if (e.ctrlKey && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault()
        setView(NAV[Number(e.code.slice(5)) - 1])
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuick(true)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault()
        void openSession({
          kind: 'adhoc',
          host: { label: S[useStore.getState().lang].local, protocol: 'local', address: '' }
        })
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW' && activeTab) {
        e.preventDefault()
        closeTab(activeTab)
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const ids = [null, ...tabs.map((t) => t.id)]
        const i = ids.indexOf(activeTab)
        setActiveTab(ids[(i + (e.shiftKey ? ids.length - 1 : 1)) % ids.length])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeTab, openSession, setActiveTab, setView])

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t.menu}>
        <div className="wordmark">Termos</div>
        {NAV.slice(0, -1).map((n, i) => (
          <NavButton key={n} item={n} index={i} />
        ))}
        <div className="nav-spacer" />
        <NavButton item={NAV[NAV.length - 1]} index={NAV.length - 1} />
      </nav>
      <main className="main">
        <div className="tabbar" role="tablist">
          <div className={'tab' + (activeTab === null ? ' active' : '')}>
            <button
              className="tab-main"
              role="tab"
              aria-selected={activeTab === null}
              onClick={() => setActiveTab(null)}
            >
              <span className="label">{viewLabel}</span>
            </button>
          </div>
          {tabs.map((tab) => {
            const p = tab.panes[tab.focused] ?? tab.panes[0]
            return (
              <div key={tab.id} className={'tab' + (activeTab === tab.id ? ' active' : '')}>
                <button
                  className="tab-main"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  title={tab.panes.map((x) => x.label).join(' | ')}
                  onClick={() => setActiveTab(tab.id)}
                  onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
                >
                  <span className={'dot ' + p.status} aria-label={p.status} />
                  <span className="label">
                    {p.label}
                    {tab.panes.length > 1 ? ` +${tab.panes.length - 1}` : ''}
                  </span>
                </button>
                <button
                  className="tab-close"
                  aria-label={fmt(t.closeTab, p.label)}
                  title={t.closeTabHint}
                  onClick={() => closeTab(tab.id)}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <div className="tab">
            <button className="tab-main" title={t.newSessionHint} onClick={() => setQuick(true)}>
              {t.newSession}
            </button>
          </div>
        </div>
        <div className="content" style={{ overflow: activeTab ? 'hidden' : 'auto' }}>
          {activeTab === null && <CurrentView view={view} />}
          {/* Terminal tabs stay mounted so their scrollback survives tab switches. */}
          {tabs.map((t) => (
            <TermTab key={t.id} tab={t} visible={t.id === activeTab} />
          ))}
        </div>
      </main>
      {quick && (
        <HostPicker
          title={t.quickConnect}
          onClose={() => setQuick(false)}
          onPick={(h) => {
            setQuick(false)
            void openSession({ kind: 'host', hostId: h.id })
          }}
          onAdhoc={(spec) => {
            setQuick(false)
            void openSession({
              kind: 'adhoc',
              host: {
                label: spec.address,
                address: spec.address,
                protocol: 'ssh',
                config: { username: spec.username, port: spec.port }
              }
            })
          }}
        />
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  const status = useStore((s) => s.status)
  const data = useStore((s) => s.data)
  if (!status) return <div className="lock" />
  if (!status.unlocked || !data) return <LockScreen />
  return (
    <>
      <Workspace />
      <SessionRequests />
      <DialogHost />
      <Toasts />
    </>
  )
}
