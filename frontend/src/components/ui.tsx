import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }) {
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
  const safe = ['active', 'approved', 'sent', 'replied', 'consented', 'contextual', 'done', 'ready'].includes(value)
  const warn = ['draft', 'needs_review', 'ambiguous', 'unknown', 'open', 'paused'].includes(value)
  return <span className={`status ${safe ? 'status-safe' : warn ? 'status-warn' : 'status-muted'}`}>{value.replaceAll('_', ' ')}</span>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' || tone === 'danger' ? AlertTriangle : Info
  return <div className={`notice notice-${tone}`} role="status"><Icon size={18} aria-hidden="true" /><div>{children}</div></div>
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{detail}</p>{action}</div>
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        {children}
      </section>
    </div>
  )
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
