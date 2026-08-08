import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { SetupScreen, LoginScreen } from './components/Auth'
import AppShell from './components/AppShell'
import type { Member } from './types'

type AuthStatus = { setup_required: boolean; environment: string; demo_mode: boolean }

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const authStatus = await api<AuthStatus>('/auth/status')
    setStatus(authStatus)
    if (!authStatus.setup_required) {
      try {
        setMember(await api<Member>('/me'))
      } catch {
        setMember(null)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (loading) return <div className="app-loading"><div className="loading-mark" />Loading Simbi Reach-Out…</div>
  if (status?.setup_required) return <SetupScreen onComplete={refresh} />
  if (!member) return <LoginScreen onComplete={refresh} />
  return <AppShell member={member} onMemberChange={setMember} onSignedOut={refresh} />
}
