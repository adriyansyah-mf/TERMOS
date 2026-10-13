import { useMemo, useState } from 'react'
import type { Host } from '../../../shared/types'
import { useStore } from '../store'
import { Modal } from './ui'

/** Searchable host list. Typing user@host:port and pressing Enter connects ad hoc. */
export function HostPicker(props: {
  title: string
  onPick(host: Host): void
  onAdhoc?(spec: { address: string; username?: string; port?: number }): void
  onClose(): void
}): React.JSX.Element {
  const hosts = useStore((s) => s.data?.hosts ?? [])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return hosts
      .filter(
        (h) =>
          !needle ||
          h.label.toLowerCase().includes(needle) ||
          h.address.toLowerCase().includes(needle) ||
          h.tags.some((t) => t.toLowerCase().includes(needle))
      )
      .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
  }, [hosts, q])

  const adhoc = (): boolean => {
    const m = /^(?:([^@\s]+)@)?([^\s:@]+)(?::(\d+))?$/.exec(q.trim())
    if (!m || !props.onAdhoc) return false
    props.onAdhoc({ username: m[1], address: m[2], port: m[3] ? Number(m[3]) : undefined })
    return true
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <input
        className="input"
        autoFocus
        placeholder={
          props.onAdhoc ? 'Cari host, atau ketik user@alamat:port lalu Enter' : 'Cari host'
        }
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel(Math.min(sel + 1, list.length - 1))
          if (e.key === 'ArrowUp') setSel(Math.max(sel - 1, 0))
          if (e.key === 'Enter') {
            if (list[sel]) props.onPick(list[sel])
            else adhoc()
          }
        }}
      />
      <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto' }}>
        {list.map((h, i) => (
          <button
            key={h.id}
            className="menu-item"
            style={{ background: i === sel ? 'var(--bg-4)' : undefined }}
            onMouseEnter={() => setSel(i)}
            onClick={() => props.onPick(h)}
          >
            <div className="cell-title">{h.label}</div>
            <div className="muted small mono">
              {h.protocol} {h.config.username ? h.config.username + '@' : ''}
              {h.address}
            </div>
          </button>
        ))}
        {!list.length && (
          <div className="dim small" style={{ padding: 10 }}>
            {props.onAdhoc && q.trim()
              ? 'Tekan Enter untuk konek langsung ke ' + q.trim()
              : 'Tidak ada host'}
          </div>
        )}
      </div>
    </Modal>
  )
}
