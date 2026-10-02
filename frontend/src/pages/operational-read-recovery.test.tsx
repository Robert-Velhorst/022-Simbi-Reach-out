import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithRouter as render } from '../test/router'
import { I18nProvider } from '../i18n'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import App from '../App'
import Dashboard from './Dashboard'
import SettingsPage from './Settings'
import { ReportsPage } from './Operations'
import { fictionalMember, operationalReads } from '../test/operational-reads'
import type { Member } from '../types'

const warning = 'The local service returned an unverified operational response. Retry only this read; do not reload or repeat a change. No result was verified.'
const member = fictionalMember as Member
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

for (const locale of ['en', 'nl'] as const) {
  const t = (key: keyof typeof en) => (locale === 'en' ? en : nl)[key]
  const cases = [
    { path: '/overview', value: operationalReads['/overview'], bad: { ...operationalReads['/overview'], counts: null }, ready: 'Your queue is clear' as const, view: <Dashboard member={member} /> },
    { path: '/reports/summary', value: operationalReads['/reports/summary'], bad: { ...operationalReads['/reports/summary'], funnel: null }, ready: 'No report data' as const, view: <ReportsPage /> },
    { path: '/settings', value: operationalReads['/settings'], bad: { ...operationalReads['/settings'], workspace: null }, ready: 'The workspace is operating under its normal approval gates.' as const, view: <SettingsPage member={member} onMemberChange={() => {}} /> },
  ]
  it.each(cases)(`${locale} $path rejects malformed results and recovers only by explicit read retry`, async ({ path, value, bad, ready, view }) => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe(`/api${path}`)
      expect(!options?.method || options.method === 'GET').toBe(true)
      return Response.json(fetcher.mock.calls.length === 1 ? bad : value)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<I18nProvider initialLocale={locale}>{view}</I18nProvider>)
    expect(await screen.findByText(t(warning))).toBeVisible()
    expect(screen.queryByText(t(ready))).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: t('Retry') }))
    expect(await screen.findByText(t(ready))).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })
  it.each(['/auth/status', '/me'] as const)(`${locale} malformed %s is not disguised as signed-out/setup state`, async path => {
    let damagedReads = 0
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(!options?.method || options.method === 'GET').toBe(true)
      const endpoint = url.replace('/api', '') as keyof typeof operationalReads
      const value = operationalReads[endpoint]
      expect(value).toBeDefined()
      if (endpoint === path && ++damagedReads === 1) return Response.json(path === '/me' ? { ...member, role: 'unverified-role' } : { ...operationalReads['/auth/status'], setup_required: 'false' })
      return Response.json(value)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<I18nProvider initialLocale={locale}><App /></I18nProvider>)
    expect(await screen.findByRole('heading', { name: t('Service unavailable') })).toBeVisible()
    expect(screen.queryByRole('button', { name: t('Sign in') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('Create workspace') })).not.toBeInTheDocument()
    expect(damagedReads).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: t('Try again') }))
    expect(await screen.findByText(t('Your queue is clear'))).toBeVisible()
    expect(damagedReads).toBe(2)
  })
}

it('does not claim a settings mutation succeeded when its follow-up read is unverified, retains mounted inputs and does not resubmit', async () => {
  let reads = 0
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/settings/provider') { expect(options?.method).toBe('POST'); writes++; return Response.json({ saved: true }) }
    expect(url).toBe('/api/settings')
    reads++
    return Response.json(reads === 2 ? { ...operationalReads['/settings'], workspace: null } : operationalReads['/settings'])
  }))
  render(<SettingsPage member={member} onMemberChange={() => {}} />)
  await screen.findByLabelText('Current password')
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'fictional retained input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save assisted provider' }))
  expect(await screen.findByText('Settings could not be verified. Retry the settings read before repeating a change; the earlier change may already be saved.')).toBeVisible()
  expect(screen.queryByText('Provider link saved. Assisted mode remains enforced.')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Current password')).toHaveValue('fictional retained input')
  expect(screen.getByRole('button', { name: 'Save assisted provider' })).toBeDisabled()
  expect(writes).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save assisted provider' })).toBeEnabled())
  expect(writes).toBe(1)
  expect(reads).toBe(3)
  expect(screen.getByLabelText('Current password')).toHaveValue('fictional retained input')
})
