// Component fixtures prove browser-state rules, not backend/provider delivery.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithDraftGuard as render } from '../test/router'
import { I18nProvider } from '../i18n'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import { CampaignsPage, ProspectsPage, TemplatesPage } from './Resources'
import { RepliesPage } from './Operations'
import ReviewQueue from './ReviewQueue'
import type { Member } from '../types'

const member: Member = { user_id: 1, workspace_id: 1, email: 'fictional@example.test', display_name: 'Fictional owner', workspace_name: 'Fictional workspace', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-01', paused_at: null, environment: 'test', demo_mode: false }
const rows = {
  campaigns: [{ id: 1, name: 'Fictional campaign', status: 'active' }],
  prospects: [{ id: 1, name: 'Fictional person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/fictional', consent_status: 'contextual', contact_handle: '', notes: '' }],
  templates: [{ id: 1, name: 'Fictional template' }],
  drafts: [{ id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Fictional person', organization: '', source_url: 'https://simbi.com/fictional', consent_status: 'contextual', campaign_name: 'Fictional campaign', template_name: 'Fictional template', state: 'ambiguous', body: 'A fictional draft body', subject: '', updated_at: '2026-10-01', quality_score: 80, safety_flags: [], content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64) }],
}
const cases = [
  { path: '/campaigns', view: <CampaignsPage member={member} onMemberChange={() => {}} />, open: 'New campaign', fields: { Name: 'Fictional new campaign', Purpose: 'An authorized fictional exchange', 'Lawful basis / outreach context': 'An authorized published request' }, submit: 'Create draft campaign', extra: { status: 'draft' } },
  { path: '/prospects', view: <ProspectsPage canEdit />, open: 'Add prospect', fields: { Name: 'Fictional new person', 'Source URL': 'https://simbi.com/new-fictional' }, submit: 'Add prospect', extra: { created_at: '2026-10-01T12:00:00Z' } },
  { path: '/prospects/import', view: <ProspectsPage canEdit />, open: 'Import CSV', fields: { 'CSV data': 'name,source_url\nFictional import,https://simbi.com/fictional-import' }, submit: 'Validate and import', extra: { valid: 1, errors: [], inserted: 1, duplicates: 0, committed: true } },
  { path: '/templates', view: <TemplatesPage canEdit />, open: 'New template', fields: { 'Template name': 'Fictional new template' }, submit: 'Create template', extra: { version: 1 } },
  { path: '/drafts', view: <ReviewQueue member={member} onMemberChange={() => {}} />, open: 'Prepare draft', fields: { Campaign: '1', Prospect: '1', Template: '1' }, submit: 'Prepare draft', extra: { state: 'needs_review', quality_score: 80, safety_flags: [] } },
  { path: '/replies', view: <RepliesPage canEdit />, open: 'Record reply', fields: { Conversation: '1', 'Reply or concise summary': 'Fictional reply' }, submit: 'Record reply', extra: { state: 'replied', received_at: '2026-10-01T12:00:00Z' } },
] as const
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

for (const locale of ['en', 'nl'] as const) {
  const t = (key: string) => (locale === 'en' ? en : nl)[key as keyof typeof en]
  it.each(cases)(`${locale} $path keeps its own reference through uncertainty, Cancel/reopen and explicit recovery`, async ({ path, view, open, fields, submit, extra }) => {
    const writes: { key: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'POST') {
        const body = JSON.parse(String(options.body))
        const key = new Headers(options.headers).get('Idempotency-Key')
        if (path === '/prospects/import' && !body.commit) {
          expect(key).toBeNull()
          return Response.json({ valid: 1, errors: [], inserted: 0, duplicates: 0, committed: false })
        }
        expect(key).toMatch(/^[a-f0-9-]{36}$/)
        writes.push({ key: key!, body })
        if (writes.length === 1) return new Response('<interrupted confirmation>', { status: 201 })
        return Response.json({ id: 41, ...body, ...extra, creation_key: key, replayed: true })
      }
      const resource = new URL(url, 'http://localhost').pathname.replace('/api/', '') as keyof typeof rows
      const items = rows[resource] ?? []
      // A lost reply confirmation really leaves the conversation in replied
      // state. Reopening must still allow selecting it to recover that attempt.
      const current = path === '/replies' && writes.length > 0 && resource === 'drafts'
        ? items.map((item) => writes.length >= 2 ? { ...item, id: 2, state: 'ambiguous' } : { ...item, state: 'replied' }) : items
      return Response.json({ items: current, total: current.length, offset: 0, limit: 50 })
    }))
    render(<I18nProvider initialLocale={locale}>{view}</I18nProvider>)
    const fill = async () => {
      const dialog = screen.getByRole('dialog')
      for (const [label, value] of Object.entries(fields)) {
        const control = await within(dialog).findByLabelText((content) => content.startsWith(t(label)))
        await waitFor(() => expect(control).toBeEnabled())
        if (control.tagName === 'SELECT') await waitFor(() => expect(within(control).getAllByRole('option').length).toBeGreaterThan(1))
        fireEvent.change(control, { target: { value: path === '/replies' && writes.length >= 2 ? '2' : value } })
      }
      return dialog
    }
    fireEvent.click(await screen.findByRole('button', { name: t(open) }))
    let dialog = await fill()
    fireEvent.submit(within(dialog).getByRole('button', { name: t(submit) }).closest('form')!)
    expect(await within(dialog).findByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'))).toBeVisible()
    const reference = () => screen.getByText(locale === 'en' ? /retry reference:/ : /Herhaalreferentie voor/)
    expect(reference()).toHaveTextContent(writes[0].key)
    expect(writes).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: t('Cancel') }))
    expect(reference()).toHaveTextContent(writes[0].key)
    fireEvent.click(screen.getByRole('button', { name: t(open) }))
    dialog = await fill()
    fireEvent.submit(within(dialog).getByRole('button', { name: t(submit) }).closest('form')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(screen.queryByText(locale === 'en' ? /retry reference:/ : /Herhaalreferentie voor/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t(open) }))
    dialog = await fill()
    fireEvent.submit(within(dialog).getByRole('button', { name: t(submit) }).closest('form')!)
    await waitFor(() => expect(writes).toHaveLength(3))
    expect(writes[2].key).not.toBe(writes[0].key)
  })
}
