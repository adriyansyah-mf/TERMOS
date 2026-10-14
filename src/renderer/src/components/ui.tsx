import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { pop, useDialogs, type DialogReq } from '../lib'

const S = {
  id: {
    cancel: 'Batal',
    ok: 'OK'
  },
  en: {
    cancel: 'Cancel',
    ok: 'OK'
  }
}

export function Modal(props: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  onClose?: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  // Move keyboard focus into the dialog unless a field already claimed it.
  useEffect(() => {
    if (!box.current?.contains(document.activeElement))
      box.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
  }, [])
  return (
    <div
      className="modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose?.()}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        className={'modal' + (props.wide ? ' wide' : '')}
      >
        <div className="modal-head">{props.title}</div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

export function Field(props: {
  label: string
  hint?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function Check(props: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  )
}

function PromptBody({ d }: { d: Extract<DialogReq, { kind: 'prompt' }> }): React.JSX.Element {
  const t = useT(S)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.fields.map((f) => [f.key, f.value ?? '']))
  )
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.select(), [])
  const done = (v: Record<string, string> | null): void => {
    pop(d)
    d.resolve(v)
  }
  return (
    <Modal
      title={d.title}
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>
            {t.cancel}
          </button>
          <button className="btn primary" onClick={() => done(values)}>
            {d.okLabel ?? t.ok}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          done(values)
        }}
      >
        {d.fields.map((f, i) => (
          <Field key={f.key} label={f.label}>
            <input
              ref={i === 0 ? first : undefined}
              className="input"
              type={f.type ?? 'text'}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function DialogHost(): React.JSX.Element | null {
  const t = useT(S)
  const d = useDialogs((s) => s.stack[0])
  if (!d) return null
  if (d.kind === 'prompt') return <PromptBody key={d.title} d={d} />
  const done = (v: boolean): void => {
    pop(d)
    d.resolve(v)
  }
  return (
    <Modal
      title={d.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>
            {t.cancel}
          </button>
          <button
            className={'btn ' + (d.danger ? 'danger' : 'primary')}
            autoFocus
            onClick={() => done(true)}
          >
            {d.okLabel ?? t.ok}
          </button>
        </>
      }
    >
      <div className="muted">{d.message}</div>
    </Modal>
  )
}
