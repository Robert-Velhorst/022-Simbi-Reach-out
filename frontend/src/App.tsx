import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { SetupScreen, LoginScreen } from './components/Auth'
import AppShell from './components/AppShell'
import { Button } from './components/ui'
import type { Member } from './types'

type AuthStatus = { setup_required: boolean; setup_token_required?: boolean; environment: string; demo_mode: boolean }

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setBootError('')
    try {
      const authStatus = await api<AuthStatus>('/auth/status')
      setStatus(authStatus)
      if (!authStatus.setup_required) {
        try {
          setMember(await api<Member>('/me'))
        } catch {
          setMember(null)
        }
      }
    } catch (cause) {
      setStatus(null)
      setMember(null)
      setBootError(cause instanceof Error ? cause.message : 'The application could not start.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (loading) return <div className="app-loading"><div className="loading-mark" />Loading Simbi Reach-Out…</div>
  if (bootError) return <main className="boot-failure" role="alert"><div className="brand-mark"><span aria-hidden="true">!</span></div><h1>Service unavailable</h1><p>{bootError}</p><Button onClick={() => void refresh()}>Try again</Button><small>No outreach action was attempted.</small></main>
  if (status?.setup_required) return <SetupScreen onComplete={refresh} setupTokenRequired={status.setup_token_required} />
  if (!member) return <LoginScreen onComplete={refresh} />
  return <AppShell member={member} onMemberChange={setMember} onSignedOut={refresh} />
}
