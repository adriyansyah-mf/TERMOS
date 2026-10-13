import { useEffect, useState } from 'react'
import { useStore, type View } from './store'
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

const NAV: { view: View; icon: string; label: string }[] = [
  { view: 'hosts', icon: '🖥', label: 'Hosts' },
  { view: 'keychain', icon: '🔑', label: 'Keychain' },
  { view: 'snippets', icon: '⚡', label: 'Snippets' },
  { view: 'forwards', icon: '⇄', label: 'Port Forwarding' },
  { view: 'proxmox', icon: '🗄', label: 'Proxmox' },
  { view: 'knownHosts', icon: '🛡', label: 'Known Hosts' },
  { view: 'history', icon: '🕘', label: 'Riwayat' }
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
    case 'settings':
      return <SettingsView />
    default:
      return <HostsView />
  }
}

function Workspace(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const tabs = useStore((s) => s.tabs)
  const activeTab = useStore((s) => s.activeTab)
  const { setView, setActiveTab, closeTab, openSession } = useStore.getState()
  const [quick, setQuick] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { tabs, activeTab } = useStore.getState()
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuick(true)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault()
        void openSession({
          kind: 'adhoc',
          host: { label: 'Lokal', protocol: 'local', address: '' }
        })
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW' && activeTab) {
        e.preventDefault()
        closeTab(activeTab)
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const ids = [null, ...tabs.map((t) => t.id)]
        const i = ids.indexOf(activeTab)
        const next = ids[(i + (e.shiftKey ? ids.length - 1 : 1)) % ids.length]
        setActiveTab(next)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeTab, openSession, setActiveTab])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          Termos
        </div>
        {NAV.map((n) => (
          <button
            key={n.view}
            className={'nav-item' + (activeTab === null && view === n.view ? ' active' : '')}
            onClick={() => setView(n.view)}
          >
            <span className="icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="nav-spacer" />
        <button
          className={'nav-item' + (activeTab === null && view === 'settings' ? ' active' : '')}
          onClick={() => setView('settings')}
        >
          <span className="icon">⚙</span>
          Settings
        </button>
      </aside>
      <main className="main">
        <div className="tabbar">
          <div
            className={'tab' + (activeTab === null ? ' active' : '')}
            onClick={() => setActiveTab(null)}
          >
            <span className="label">⌂ Vault</span>
          </div>
          {tabs.map((t) => {
            const p = t.panes[t.focused] ?? t.panes[0]
            return (
              <div
                key={t.id}
                className={'tab' + (activeTab === t.id ? ' active' : '')}
                onClick={() => setActiveTab(t.id)}
                onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
                title={t.panes.map((x) => x.label).join(' | ')}
              >
                <span className={'dot ' + p.status} />
                <span className="label">
                  {p.label}
                  {t.panes.length > 1 ? ` +${t.panes.length - 1}` : ''}
                </span>
                <button
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
          <div className="tab" title="Sesi baru (Ctrl+K)" onClick={() => setQuick(true)}>
            ＋
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
          title="Quick connect"
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
