import { useState, type FormEvent } from 'react'
import { Network, ShieldCheck } from 'lucide-react'
import { ApiError, post } from '../api'
import { Button, Field, Input, Notice } from './ui'

type AuthResult = { status: string; csrf_token: string }

export function SetupScreen({ onComplete, setupTokenRequired = false }: { onComplete: () => void; setupTokenRequired?: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      await post<AuthResult>('/auth/setup', Object.fromEntries(form))
      onComplete()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Setup could not be completed')
    } finally {
      setBusy(false)
    }
  }

  return <AuthLayout title="Create your local workspace" detail="Your records stay in the local database. No platform account credentials are requested or stored.">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <form onSubmit={submit} className="form-stack">
      {setupTokenRequired ? <Field label="Setup token" hint="Use the bootstrap token configured by the deployment operator."><Input name="setup_token" type="password" required autoComplete="off" /></Field> : null}
      <Field label="Your name"><Input name="display_name" required minLength={2} autoComplete="name" /></Field>
      <Field label="Workspace name"><Input name="workspace_name" required minLength={2} defaultValue="Simbi outreach" /></Field>
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password" hint="At least 12 characters; stored as a salted scrypt hash."><Input name="password" type="password" required minLength={12} autoComplete="new-password" /></Field>
      <Button disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace'}</Button>
    </form>
  </AuthLayout>
}

export function LoginScreen({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      await post<AuthResult>('/auth/login', Object.fromEntries(form))
      onComplete()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return <AuthLayout title="Welcome back" detail="Sign in to your local Simbi Reach-Out workspace.">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <form onSubmit={submit} className="form-stack">
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
      <Button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  </AuthLayout>
}

function AuthLayout({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return <main className="auth-page">
    <section className="auth-brand">
      <div className="brand-mark"><Network /></div>
      <h1>Simbi Reach-Out</h1>
      <p>Prepare thoughtful outreach. Keep the final send human.</p>
      <div className="auth-promise"><ShieldCheck /><span>Local-first data, review gates, and an auditable assisted-send workflow.</span></div>
    </section>
    <section className="auth-card"><h2>{title}</h2><p>{detail}</p>{children}</section>
  </main>
}
