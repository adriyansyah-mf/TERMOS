import { useRef, useState } from 'react'
import { useStore, type Tab } from '../store'
import { HostPicker } from './HostPicker'
import { SftpPanel } from './SftpPanel'
import { TerminalPane, type TerminalHandle } from './TerminalPane'

export function TermTab({ tab, visible }: { tab: Tab; visible: boolean }): React.JSX.Element {
  const { closePane, reconnect, focusPane, toggleSftp, openSession } = useStore.getState()
  const snippets = useStore((s) => s.data?.snippets ?? [])
  const hosts = useStore((s) => s.data?.hosts ?? [])
  const handles = useRef(new Map<string, TerminalHandle>())
  const [picking, setPicking] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [search, setSearch] = useState('')
  const [broadcast, setBroadcast] = useState(false)

  const focusedPane = tab.panes[tab.focused] ?? tab.panes[0]
  const focusedHost = hosts.find((h) => h.id === focusedPane?.hostId)
  const sftpAvailable = focusedHost && focusedHost.protocol === 'ssh'
  const n = tab.panes.length
  const cols = n === 1 ? 1 : 2
  const rows = Math.ceil(n / cols)

  const runSnippet = (script: string): void => {
    const text = script.replace(/\r?\n/g, '\r') + '\r'
    const targets = broadcast ? tab.panes : [focusedPane]
    for (const p of targets) if (p) handles.current.get(p.sessionId)?.paste(text)
    setShowSnippets(false)
    handles.current.get(focusedPane.sessionId)?.focus()
  }

  return (
    <div
      className="term-tab"
      style={{ display: visible ? 'flex' : 'none', flexDirection: 'column' }}
    >
      <div className="term-toolbar">
        <button
          className="btn sm"
          onClick={() => setPicking(true)}
          disabled={n >= 4}
          title="Belah layar (maks 4)"
        >
          Split
        </button>
        <button
          className={'btn sm' + (tab.sftp ? ' on' : '')}
          aria-pressed={!!tab.sftp}
          disabled={!sftpAvailable && !tab.sftp}
          onClick={() => toggleSftp(tab.id)}
          title={
            sftpAvailable ? 'Buka file manager SFTP' : 'SFTP hanya untuk host SSH yang tersimpan'
          }
        >
          SFTP
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className={'btn sm' + (showSnippets ? ' on' : '')}
            aria-expanded={showSnippets}
            onClick={() => setShowSnippets(!showSnippets)}
          >
            Snippet
          </button>
          {showSnippets && (
            <div
              className="menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowSnippets(false)
              }}
            >
              {!snippets.length && (
                <div className="muted small" style={{ padding: 10 }}>
                  Belum ada snippet. Buat di menu Snippets (Ctrl 3).
                </div>
              )}
              {snippets.map((s, i) => (
                <button
                  key={s.id}
                  className="menu-item"
                  autoFocus={i === 0}
                  onClick={() => runSnippet(s.script)}
                >
                  <div className="cell-title ellipsis">{s.label}</div>
                  <div className="muted small mono ellipsis">{s.script.split('\n')[0]}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {n > 1 && (
          <label className="row small muted" title="Snippet dikirim ke semua panel">
            <input
              type="checkbox"
              checked={broadcast}
              onChange={(e) => setBroadcast(e.target.checked)}
            />
            Broadcast snippet
          </label>
        )}
        <span className="grow" />
        <input
          className="input term-search"
          placeholder="Cari di terminal…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (e.target.value) handles.current.get(focusedPane.sessionId)?.search(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              handles.current.get(focusedPane.sessionId)?.search(search, e.shiftKey)
            if (e.key === 'Escape') {
              setSearch('')
              handles.current.get(focusedPane.sessionId)?.focus()
            }
          }}
        />
        <button
          className="btn sm ghost"
          title="Bersihkan layar"
          onClick={() => handles.current.get(focusedPane.sessionId)?.clear()}
        >
          Bersihkan
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          className="term-panes"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`
          }}
        >
          {tab.panes.map((p, i) => (
            <TerminalPane
              key={p.sessionId}
              ref={(h) => {
                if (h) handles.current.set(p.sessionId, h)
                else handles.current.delete(p.sessionId)
              }}
              pane={p}
              focused={visible && i === tab.focused}
              onFocus={() => focusPane(tab.id, i)}
              onClose={() => closePane(tab.id, p.sessionId)}
              onReconnect={() => void reconnect(tab.id, p.sessionId)}
            />
          ))}
        </div>
        {tab.sftp && (
          <SftpPanel
            key={tab.sftp.hostId}
            hostId={tab.sftp.hostId}
            onClose={() => toggleSftp(tab.id)}
          />
        )}
      </div>
      {picking && (
        <HostPicker
          title="Buka di panel baru"
          onClose={() => setPicking(false)}
          onPick={(h) => {
            setPicking(false)
            void openSession({ kind: 'host', hostId: h.id }, { tabId: tab.id })
          }}
          onAdhoc={(spec) => {
            setPicking(false)
            void openSession(
              {
                kind: 'adhoc',
                host: {
                  address: spec.address,
                  protocol: 'ssh',
                  config: { username: spec.username, port: spec.port }
                }
              },
              { tabId: tab.id }
            )
          }}
        />
      )}
    </div>
  )
}
