import { useI18n } from '../i18n'
import { useEffect, useId, useRef, type ComponentProps, type InputHTMLAttributes, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export function Button({ className = '', variant = 'primary', ...props }: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
  return <button className={`button button-${variant} ${className}`} {...props} />
}

export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {title ? <header className="panel-header"><h2>{title}</h2>{action}</header> : null}
      {children}
    </section>
  )
}

export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input" {...props} />
}

export function Status({ value }: { value: string }) {
  const { formatCode } = useI18n()
  const safe = ['active', 'approved', 'sent', 'replied', 'consented', 'contextual', 'done', 'ready'].includes(value)
  const warn = ['draft', 'needs_review', 'ambiguous', 'unknown', 'open', 'paused'].includes(value)
  return <span className={`status ${safe ? 'status-safe' : warn ? 'status-warn' : 'status-muted'}`}>{formatCode(value)}</span>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' || tone === 'danger' ? AlertTriangle : Info
  return <div className={`notice notice-${tone}`} role="status"><Icon size={18} aria-hidden="true" /><div>{children}</div></div>
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{detail}</p>{action}</div>
}

export function Modal({ title, children, onClose, returnFocusRef, closeDisabled = false, className = '', id }: { title: string; children: ReactNode; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null>; closeDisabled?: boolean; className?: string; id?: string }) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = returnFocusRef?.current ?? document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    closeRef.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      // The trigger may have been replaced by the next workflow action while open.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Restore the live replacement, not its removed predecessor.
      const returnTarget = returnFocusRef?.current ?? previousFocus
      if (returnTarget instanceof HTMLElement && returnTarget.isConnected) returnTarget.focus({ preventScroll: true })
    }
  }, [returnFocusRef])

  return (
    <dialog ref={dialogRef} id={id} className={`modal ${className}`} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
          .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, [hidden]') && element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          // Closing on mousedown must not let its later default focus action
          // replace the restored trigger with the page body.
          event.preventDefault()
          onClose()
        }
      }}>
      <header><h2 id={titleId}>{title}</h2><button ref={closeRef} type="button" className="icon-button" onClick={onClose} disabled={closeDisabled} aria-label={t("Close")}><X size={20} /></button></header>
      {children}
    </dialog>
  )
}
