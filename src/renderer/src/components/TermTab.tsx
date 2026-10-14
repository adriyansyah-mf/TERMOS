import { useRef, useState } from 'react'
import { useT } from '../i18n'
import { useStore, type Tab } from '../store'
import { HostPicker } from './HostPicker'
import { ShareDialog } from './ShareDialog'
import { SftpPanel } from './SftpPanel'
import { TerminalPane, type TerminalHandle } from './TerminalPane'

const S = {
  id: {
    splitHint: 'Belah layar (maks 4)',
    openSftp: 'Buka file manager SFTP',
    sftpSshOnly: 'SFTP hanya untuk host SSH yang tersimpan',
    shareHint: 'Bagikan panel aktif secara live lewat server sync',
    share: 'Bagikan',
    noSnippets: 'Belum ada snippet. Buat di menu Snippets (Ctrl 3).',
    broadcastHint: 'Snippet dikirim ke semua panel',
    broadcast: 'Broadcast snippet',
    searchPlaceholder: 'Cari di terminal…',
    clearHint: 'Bersihkan layar',
    clear: 'Bersihkan',
    openInNewPane: 'Buka di panel baru'
  },
  en: {
    splitHint: 'Split pane (max 4)',
    openSftp: 'Open the SFTP file manager',
    sftpSshOnly: 'SFTP is only available for saved SSH hosts',
    shareHint: 'Share the active pane live via the sync server',
    share: 'Share',
    noSnippets: 'No snippets yet. Create them in the Snippets menu (Ctrl 3).',
    broadcastHint: 'Snippets are sent to all panes',
    broadcast: 'Broadcast snippet',
    searchPlaceholder: 'Search terminal…',
    clearHint: 'Clear screen',
    clear: 'Clear',
    openInNewPane: 'Open in a new pane'
  }
}

export function TermTab({ tab, visible }: { tab: Tab; visible: boolean }): React.JSX.Element {
  const t = useT(S)
  const { closePane, reconnect, focusPane, toggleSftp, openSession } = useStore.getState()
  const snippets = useStore((s) => s.data?.snippets ?? [])
  const hosts = useStore((s) => s.data?.hosts ?? [])
  const handles = useRef(new Map<string, TerminalHandle>())
  const [picking, setPicking] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [search, setSearch] = useState('')
  const [broadcast, setBroadcast] = useState(false)
  const [sharing, setSharing] = useState(false)

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
          title={t.splitHint}
        >
          Split
        </button>
        <button
          className={'btn sm' + (tab.sftp ? ' on' : '')}
          aria-pressed={!!tab.sftp}
          disabled={!sftpAvailable && !tab.sftp}
          onClick={() => toggleSftp(tab.id)}
          title={sftpAvailable ? t.openSftp : t.sftpSshOnly}
        >
          SFTP
        </button>
        <button
          className="btn sm"
          disabled={!focusedPane || focusedPane.target.kind === 'multiplayer'}
          onClick={() => setSharing(true)}
          title={t.shareHint}
        >
          {t.share}
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
                  {t.noSnippets}
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
          <label className="row small muted" title={t.broadcastHint}>
            <input
              type="checkbox"
              checked={broadcast}
              onChange={(e) => setBroadcast(e.target.checked)}
            />
            {t.broadcast}
          </label>
        )}
        <span className="grow" />
        <input
          className="input term-search"
          placeholder={t.searchPlaceholder}
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
          title={t.clearHint}
          onClick={() => handles.current.get(focusedPane.sessionId)?.clear()}
        >
          {t.clear}
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
      {sharing && focusedPane && (
        <ShareDialog
          sessionId={focusedPane.sessionId}
          label={focusedPane.label}
          onClose={() => setSharing(false)}
        />
      )}
      {picking && (
        <HostPicker
          title={t.openInNewPane}
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
