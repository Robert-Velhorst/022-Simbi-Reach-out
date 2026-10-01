import { LanguagePicker, useI18n } from '../i18n'
import { useState, type FormEvent } from 'react'
import { Network, ShieldCheck } from 'lucide-react'
import { ApiError, post } from '../api'
import { Button, Field, Input, Notice } from './ui'
import { useSubmitFocus } from './useSubmitFocus'

type AuthResult = { status: string; csrf_token: string }

export function SetupScreen({ onComplete, setupTokenRequired = false }: { onComplete: () => void; setupTokenRequired?: boolean }) {
  const { t, formatMessage } = useI18n()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rememberSubmitFocus = useSubmitFocus(busy)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    rememberSubmitFocus(event.currentTarget)
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

  return <AuthLayout title={t("Create your local workspace")} detail={t("Your records stay in the local database. No platform account credentials are requested or stored.")}>
    {error ? <Notice tone="danger">{formatMessage(error)}</Notice> : null}
    <form onSubmit={submit} className="form-stack">
      {setupTokenRequired ? <Field label={t("Setup token")} hint={t("Use the bootstrap token configured by the deployment operator.")}><Input name="setup_token" type="password" required autoComplete="off" /></Field> : null}
      <Field label={t("Your name")}><Input name="display_name" required minLength={2} autoComplete="name" /></Field>
      <Field label={t("Workspace name")}><Input name="workspace_name" required minLength={2} defaultValue="Simbi outreach" /></Field>
      <Field label={t("Email")}><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label={t("Password")} hint={t("At least 12 characters; stored as a salted scrypt hash.")}><Input name="password" type="password" required minLength={12} autoComplete="new-password" /></Field>
      <Button disabled={busy}>{busy ? t("Creating workspace…") : t("Create workspace")}</Button>
    </form>
  </AuthLayout>
}

export function LoginScreen({ onComplete }: { onComplete: () => void }) {
  const { t, formatMessage } = useI18n()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rememberSubmitFocus = useSubmitFocus(busy)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    rememberSubmitFocus(event.currentTarget)
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

  return <AuthLayout title={t("Welcome back")} detail={t("Sign in to your local Simbi Reach-Out workspace.")}>
    {error ? <Notice tone="danger">{formatMessage(error)}</Notice> : null}
    <form onSubmit={submit} className="form-stack">
      <Field label={t("Email")}><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label={t("Password")}><Input name="password" type="password" required autoComplete="current-password" /></Field>
      <Button disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</Button>
    </form>
  </AuthLayout>
}

function AuthLayout({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  const { t } = useI18n()
  return <main className="auth-page">
    <section className="auth-brand">
      <div className="brand-mark"><Network /></div>
      <h1>Simbi Reach-Out</h1>
      <p>{t("Prepare thoughtful outreach. Keep the final send human.")}</p>
      <div className="auth-promise"><ShieldCheck /><span>{t("Local-first data, review gates, and an auditable assisted-send workflow.")}</span></div>
    </section>
    <section className="auth-card"><LanguagePicker /><h2>{title}</h2><p>{detail}</p>{children}</section>
  </main>
}
