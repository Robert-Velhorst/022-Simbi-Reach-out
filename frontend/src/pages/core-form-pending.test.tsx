import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithDraftGuard as render } from '../test/router'
import { I18nProvider } from '../i18n'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import { CampaignsPage, ProspectsPage, TemplatesPage } from './Resources'
import { RepliesPage, RemindersPage } from './Operations'
import ReviewQueue from './ReviewQueue'
import type { Member } from '../types'

const member: Member = { user_id: 1, workspace_id: 1, email: 'fictional@example.test', display_name: 'Fictional owner', workspace_name: 'Fictional workspace', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-01', paused_at: null, environment: 'test', demo_mode: false }
const rows = {
  campaigns: [{ id: 1, name: 'Fictional campaign', status: 'active', purpose: 'Fictional exchange', lawful_basis: 'Fictional request', description: '', daily_limit: 10, cooldown_minutes: 1440 }],
  prospects: [{ id: 1, name: 'Fictional person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/fictional', consent_status: 'contextual', contact_handle: '', notes: '', created_at: '2026-10-02T12:00:00Z' }],
  templates: [{ id: 1, name: 'Fictional template', provider: 'simbi', body: 'A fictional template body', subject: '', version: 1 }],
  drafts: [{ id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Fictional person', organization: '', source_url: 'https://simbi.com/fictional', consent_status: 'contextual', campaign_name: 'Fictional campaign', template_name: 'Fictional template', state: 'ambiguous', body: 'A fictional draft body', subject: '', updated_at: '2026-10-01', quality_score: 80, safety_flags: [], content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64) }],
}
const cases = [
  { name: 'campaign', view: <CampaignsPage member={member} onMemberChange={() => {}} />, open: 'New campaign', dialog: 'Create campaign', fields: { Name: 'Fictional new campaign', Purpose: 'An authorized fictional exchange', 'Lawful basis / outreach context': 'An authorized published request' }, submit: 'Create draft campaign' },
  { name: 'prospect', view: <ProspectsPage canEdit />, open: 'Add prospect', dialog: 'Add prospect', fields: { Name: 'Fictional new person', 'Source URL': 'https://simbi.com/new-fictional' }, submit: 'Add prospect' },
  { name: 'CSV preview', view: <ProspectsPage canEdit />, open: 'Import CSV', dialog: 'Import reviewed prospects', fields: { 'CSV data': 'name,source_url\nFictional import,https://simbi.com/fictional-import' }, submit: 'Validate and import' },
  { name: 'template', view: <TemplatesPage canEdit />, open: 'New template', dialog: 'Create template', fields: { 'Template name': 'Fictional new template' }, submit: 'Create template' },
  { name: 'draft', view: <ReviewQueue member={member} onMemberChange={() => {}} />, open: 'Prepare draft', dialog: 'Prepare a deterministic draft', fields: { Campaign: '1', Prospect: '1', Template: '1' }, submit: 'Prepare draft' },
  { name: 'reply', view: <RepliesPage canEdit />, open: 'Record reply', dialog: 'Record provider reply', fields: { Conversation: '1', 'Reply or concise summary': 'Fictional reply' }, submit: 'Record reply' },
  { name: 'reminder', view: <RemindersPage canEdit />, open: 'New reminder', dialog: 'Create reminder', fields: { Conversation: '1', Reminder: 'Fictional reminder', Due: '2027-11-02T07:58' }, submit: 'Create reminder' },
] as const

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('core form pending and uncertain response protection', () => {
  for (const locale of ['en', 'nl'] as const) {
    const t = (key: string) => (locale === 'en' ? en : nl)[key as keyof typeof en]
    const labelPattern = (key: string) => (content: string) => content.startsWith(t(key))
    it.each(cases)(`${locale} $name refuses repeat submit and dismissal, then keeps inputs after unverified response`, async ({ view, open, dialog: title, fields, submit }) => {
      let finish!: (value: Response) => void
      const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
        if (options.method === 'POST') return new Promise<Response>((resolve) => { finish = resolve })
        const key = new URL(url, 'http://localhost').pathname.replace('/api/', '') as keyof typeof rows
        const items = rows[key] ?? []
        return Response.json({ items, limit: 50, offset: 0, total: items.length })
      })
      vi.stubGlobal('fetch', fetchMock)
      render(<I18nProvider initialLocale={locale}>{view}</I18nProvider>)
      fireEvent.click(await screen.findByRole('button', { name: t(open) }))
      const dialog = await screen.findByRole('dialog', { name: t(title) })
      const controls = within(dialog)
      for (const [label, value] of Object.entries(fields)) {
        const field = await controls.findByLabelText(labelPattern(label))
        await waitFor(() => expect(field).toBeEnabled())
        fireEvent.change(field, { target: { value } })
      }
      const form = controls.getByRole('button', { name: t(submit) }).closest('form')!
      // Direct consecutive submit events reproduce the gap before a render,
      // even though normal repeated Enter should be blocked by disabled UI.
      act(() => { fireEvent.submit(form); fireEvent.submit(form) })
      expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
      expect(controls.getByRole('button', { name: t(submit) })).toBeDisabled()
      expect(controls.getByRole('button', { name: t('Cancel') })).toBeDisabled()
      expect(controls.getByRole('button', { name: t('Close') })).toBeDisabled()
      expect(form).toHaveAttribute('tabindex', '0')
      expect(controls.getByText(t('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.'))).toBeVisible()
      for (const label of Object.keys(fields)) expect(controls.getByLabelText(labelPattern(label))).toBeDisabled()
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      expect(dialog).toBeInTheDocument()
      await act(async () => { finish(Response.json({})) })
      expect(await controls.findByText(t('The request outcome is not confirmed. It may already have changed local records. Check the current state before retrying; do not assume it failed.'))).toBeVisible()
      for (const [label, value] of Object.entries(fields)) expect(controls.getByLabelText(labelPattern(label))).toHaveValue(value)
      expect(controls.getByRole('button', { name: t('Cancel') })).toBeEnabled()
      expect(form).not.toHaveAttribute('tabindex')
      expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    })
  }

  it('keeps the CSV transaction locked between its verified preview and uncertain commit', async () => {
    let finishPreview!: (value: Response) => void
    let finishCommit!: (value: Response) => void
    const requests: boolean[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method !== 'POST') return Response.json({ items: [], total: 0, limit: 50, offset: 0 })
      const commit = JSON.parse(String(options.body)).commit as boolean
      requests.push(commit)
      return new Promise<Response>((resolve) => { if (commit) finishCommit = resolve; else finishPreview = resolve })
    }))
    render(<ProspectsPage canEdit />)
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    const dialog = await screen.findByRole('dialog')
    const csv = within(dialog).getByRole('textbox')
    fireEvent.change(csv, { target: { value: 'name,source_url\nFictional import,https://simbi.com/fictional-import' } })
    const form = csv.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(requests).toEqual([false])
    await act(async () => { finishPreview(Response.json({ valid: 1, errors: [], inserted: 0, duplicates: 0, committed: false })) })
    expect(requests).toEqual([false, true])
    expect(csv).toBeDisabled()
    fireEvent.submit(form)
    expect(requests).toEqual([false, true])
    await act(async () => { finishCommit(Response.json({})) })
    expect(await within(dialog).findByText(/may already have changed local records/)).toBeVisible()
    expect(csv).toBeEnabled()
    expect(csv).toHaveValue('name,source_url\nFictional import,https://simbi.com/fictional-import')
    expect(requests).toEqual([false, true])
  })
})
