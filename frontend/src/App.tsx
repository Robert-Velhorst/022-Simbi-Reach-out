import { LanguagePicker, useI18n } from './i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { SetupScreen, LoginScreen } from './components/Auth'
import AppShell from './components/AppShell'
import { Button } from './components/ui'
import type { Member } from './types'
import type { RetirementReceipt } from './components/RetirementControls'
import RetiredScreen from './components/RetiredScreen'

type AuthStatus = { setup_required: boolean; installation_retired?: boolean | 0 | 1; setup_token_required?: boolean; environment: string; demo_mode: boolean }

export default function App() {
  const { t, formatMessage } = useI18n()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState('')
  const [retired, setRetired] = useState(false)
  const [receipt, setReceipt] = useState<RetirementReceipt | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setBootError('')
    try {
      const authStatus = await api<AuthStatus>('/auth/status')
      setStatus(authStatus)
      setRetired(Boolean(authStatus.installation_retired))
      if (!authStatus.setup_required && !authStatus.installation_retired) {
        try {
          setMember(await api<Member>('/me'))
        } catch (cause) {
          if (!(cause instanceof ApiError) || !['authentication_required', 'session_expired'].includes(cause.code)) throw cause
          setMember(null)
        }
      } else setMember(null)
    } catch (cause) {
      setStatus(null)
      setMember(null)
      setBootError(cause instanceof Error ? cause.message : 'The application could not start.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    let subscription: BroadcastChannel
    try { subscription = new BroadcastChannel('simbi-installation-lifecycle') }
    catch { return } // Restricted browsers still detect retirement on reload.
    channel.current = subscription
    subscription.onmessage = (event) => { if (event.data === 'retired') void refresh() }
    return () => { channel.current = null; subscription.close() }
  }, [refresh])
  function onRetired(completed: RetirementReceipt) {
    setReceipt(completed); setRetired(true); setMember(null)
    channel.current?.postMessage('retired') // No identity, receipt or capability token in cross-tab messages.
  }

  if (loading) return <div className="app-loading"><LanguagePicker /><div className="loading-mark" />{t("Loading Simbi Reach-Out…")}</div>
  if (bootError) return <main className="boot-failure" role="alert"><LanguagePicker /><div className="brand-mark"><span aria-hidden="true">!</span></div><h1>{t("Service unavailable")}</h1><p>{formatMessage(bootError)}</p><Button onClick={() => void refresh()}>{t("Try again")}</Button><small>{t("No outreach action was attempted.")}</small></main>
  if (retired) return <RetiredScreen receipt={receipt} />
  if (status?.setup_required) return <SetupScreen onComplete={refresh} setupTokenRequired={status.setup_token_required} />
  if (!member) return <LoginScreen onComplete={refresh} />
  return <AppShell member={member} onMemberChange={setMember} onSignedOut={refresh} onRetired={onRetired} />
}
