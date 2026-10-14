import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Host } from '../../../shared/types'
import { api, bridge } from '../api'
import { fmt, useT } from '../i18n'
import { subscribeOutput, useStore, type Pane } from '../store'
import { themeFor } from '../themes'

const S = {
  id: {
    reconnect: 'Sambung ulang',
    closePane: 'Tutup panel',
    closePaneLabel: 'Tutup panel %s',
    connFailed: 'Koneksi gagal',
    sessionEnded: 'Sesi berakhir',
    close: 'Tutup'
  },
  en: {
    reconnect: 'Reconnect',
    closePane: 'Close pane',
    closePaneLabel: 'Close pane %s',
    connFailed: 'Connection failed',
    sessionEnded: 'Session ended',
    close: 'Close'
  }
}

export interface TerminalHandle {
  paste(text: string): void
  focus(): void
  search(term: string, backwards?: boolean): void
  clear(): void
}

export const TerminalPane = forwardRef<
  TerminalHandle,
  {
    pane: Pane
    focused: boolean
    onFocus(): void
    onClose(): void
    onReconnect(): void
  }
>(function TerminalPane({ pane, focused, onFocus, onClose, onReconnect }, ref) {
  const t = useT(S)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const settings = useStore((s) => s.data?.settings)
  const host = useStore((s) => s.data?.hosts.find((h) => h.id === pane.hostId)) as Host | undefined
  const themeName = host?.config.theme || settings?.theme
  const fontSize = host?.config.fontSize || settings?.fontSize || 14

  useImperativeHandle(ref, () => ({
    paste: (text) => termRef.current?.paste(text),
    focus: () => termRef.current?.focus(),
    search: (term, back) =>
      back ? searchRef.current?.findPrevious(term) : searchRef.current?.findNext(term),
    clear: () => termRef.current?.clear()
  }))

  // One xterm instance per session.
  useEffect(() => {
    const el = hostRef.current!
    const term = new Terminal({
      fontFamily: settings?.fontFamily,
      fontSize,
      cursorBlink: settings?.cursorBlink ?? true,
      scrollback: settings?.scrollback ?? 10000,
      theme: themeFor(themeName),
      allowProposedApi: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: false
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon((_e, uri) => void api.openExternal(uri)))
    term.open(el)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* fall back to the DOM renderer */
    }
    termRef.current = term
    searchRef.current = search

    // Ctrl+Shift+C / Ctrl+Shift+V for copy/paste, like most Linux terminals.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      if (e.code === 'KeyV') {
        void navigator.clipboard.readText().then((txt) => term.paste(txt))
        return false
      }
      return true
    })

    const sessionId = pane.sessionId
    const unsub = subscribeOutput(sessionId, (d) => term.write(d))
    const onData = term.onData((d) => bridge.write(sessionId, d))
    const onResize = term.onResize(({ cols, rows }) => bridge.resize(sessionId, cols, rows))

    const doFit = (): void => {
      if (!el.offsetWidth || !el.offsetHeight) return
      try {
        fit.fit()
      } catch {
        /* element detached */
      }
    }
    const ro = new ResizeObserver(() => requestAnimationFrame(doFit))
    ro.observe(el)
    doFit()
    bridge.resize(sessionId, term.cols, term.rows)
    term.focus()

    return () => {
      ro.disconnect()
      unsub()
      onData.dispose()
      onResize.dispose()
      term.dispose()
      termRef.current = null
    }
    // Settings changes are applied below without recreating the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.sessionId])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = themeFor(themeName)
    term.options.fontSize = fontSize
    if (settings?.fontFamily) term.options.fontFamily = settings.fontFamily
    term.options.cursorBlink = settings?.cursorBlink ?? true
  }, [themeName, fontSize, settings?.fontFamily, settings?.cursorBlink])

  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  const bg = themeFor(themeName).background
  const ended = pane.status === 'closed' || pane.status === 'error'

  return (
    <div
      className={'pane' + (focused ? ' focused' : '')}
      style={{ ['--term-bg' as string]: bg }}
      onMouseDown={onFocus}
    >
      <div className="pane-head">
        <span className={'dot ' + pane.status} aria-label={pane.status} />
        <span className="ellipsis">{pane.label}</span>
        <span className="grow" />
        {ended && (
          <button className="btn sm ghost" onClick={onReconnect}>
            {t.reconnect}
          </button>
        )}
        <button
          className="btn sm ghost"
          onClick={onClose}
          title={t.closePane}
          aria-label={fmt(t.closePaneLabel, pane.label)}
        >
          ✕
        </button>
      </div>
      <div
        className="pane-body"
        ref={hostRef}
        onContextMenu={(e) => {
          // Right click: copy selection if any, otherwise paste (PuTTY-style).
          e.preventDefault()
          const term = termRef.current
          if (!term) return
          const sel = term.getSelection()
          if (sel) {
            void navigator.clipboard.writeText(sel)
            term.clearSelection()
          } else void navigator.clipboard.readText().then((x) => term.paste(x))
        }}
      />
      {ended && (
        <div className="pane-overlay" style={{ pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', textAlign: 'center' }}>
            <div className="muted" style={{ marginBottom: 10 }}>
              {pane.status === 'error' ? pane.message || t.connFailed : t.sessionEnded}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={onReconnect}>
                {t.reconnect}
              </button>
              <button className="btn" onClick={onClose}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
