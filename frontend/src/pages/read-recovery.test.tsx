import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithDraftGuard as render } from '../test/router'
import { coreReadRows } from '../test/page-records'
import { I18nProvider } from '../i18n'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import { CampaignsPage, ProspectsPage, TemplatesPage } from './Resources'
import { AuditPage, RemindersPage, RepliesPage } from './Operations'
import ReviewQueue from './ReviewQueue'
import type { Member } from '../types'

const member: Member = { user_id: 1, workspace_id: 1, email: 'fictional@example.test', display_name: 'Fictional owner', workspace_name: 'Fictional workspace', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-02', paused_at: null, environment: 'test', demo_mode: false }
const cases = [
  { path: 'campaigns', field: 'name', name: 'Fictional campaign', view: <CampaignsPage member={member} onMemberChange={() => {}} /> },
  { path: 'prospects', field: 'name', name: 'Fictional person', view: <ProspectsPage canEdit /> },
  { path: 'templates', field: 'body', name: 'Fictional local template only', view: <TemplatesPage canEdit /> },
  { path: 'drafts', field: 'safety_flags', name: 'Fictional person', view: <ReviewQueue member={member} onMemberChange={() => {}} /> },
  { path: 'replies', field: 'body', name: 'Fictional local reply only', view: <RepliesPage canEdit /> },
  { path: 'reminders', field: 'title', name: 'Fictional reminder', view: <RemindersPage canEdit /> },
  { path: 'audit', field: 'entity_type', name: 'campaign created', view: <AuditPage /> },
] as const
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
for (const locale of ['en', 'nl'] as const) {
  const t = (key: keyof typeof en) => (locale === 'en' ? en : nl)[key]
  it.each(cases)(`${locale} $path rejects malformed rows and explicitly recovers without writes`, async ({ path, field, name, view }) => {
    let reads = 0
    const writes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (options.method && options.method !== 'GET') writes.push(url)
      const resource = new URL(url, 'http://localhost').pathname.replace('/api/', '')
      let items: unknown[] = []
      if (resource === path) {
        reads++
        const row = coreReadRows[path]
        items = [reads === 1 ? { ...row, [field]: { private: 'Never render or retain this damaged value' } } : row]
      }
      return Response.json({ items, total: items.length, limit: 50, offset: 0 })
    }))
    render(<I18nProvider initialLocale={locale}>{view}</I18nProvider>)
    expect(await screen.findByText(t('The local service returned an unverified record list. Retry this read without reloading or resubmitting a change; no result was verified.'))).toBeVisible()
    expect(screen.queryByText('Never render or retain this damaged value')).not.toBeInTheDocument()
    expect(reads).toBe(1)
    expect(writes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: t('Retry') }))
    if (path === 'audit') await screen.findByText(locale === 'en' ? 'campaign created' : 'campagne aangemaakt')
    else if (path === 'drafts') await screen.findByRole('heading', { name })
    else await screen.findByText(name)
    await waitFor(() => expect(screen.queryByText(t('The local service returned an unverified record list. Retry this read without reloading or resubmitting a change; no result was verified.'))).not.toBeInTheDocument())
    expect(reads).toBe(2)
    expect(writes).toEqual([])
  })
}
