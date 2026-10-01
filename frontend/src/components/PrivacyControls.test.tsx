import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import PrivacyControls from './PrivacyControls'

const plan = { plan_id: 'a'.repeat(32), expires_at: '2030-01-01T00:00:00Z', cutoff: '2025-01-01T00:00:00Z', retention_days: 365, counts: { prospects: 1, drafts: 2, handoffs: 1, replies: 3, reminders: 1 }, contacts: [{ id: 7, name: 'Fictional Person' }], protected_contacts: 4, remaining_eligible_contacts: 2 }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const receipt = { plan_id: plan.plan_id, counts: plan.counts, backup_file: 'fictional-recovery.db', completed_at: '2026-10-01T10:00:00Z', replayed: false }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openConfirmation() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
  await screen.findByText('Fictional Person')
  fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
  return screen.getByRole('dialog', { name: 'Confirm local removal' })
}

describe('personal cleanup controls', () => {
  it.each(['campaign', 'template'] as const)('selects %s with an exact preview and scope-specific receipt', async (kind) => {
    const requests: Array<{ url: string; body: unknown }> = []
    const scopedPlan = { ...plan, kind, contacts: [], records: [{ id: 7, name: 'Fictional Record' }], restricted_contacts: kind === 'campaign' ? [{ id: 8, name: 'Fictional Retained Contact' }] : [], counts: { prospects: 0, drafts: 0, handoffs: 0, replies: 0, reminders: 0, [kind === 'campaign' ? 'campaigns' : 'templates']: 1, ...(kind === 'template' ? { template_links: 2 } : { restricted_contacts: 1 }) } }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      requests.push({ url, body: options?.body ? JSON.parse(String(options.body)) : null })
      return response(url.endsWith('/confirm') ? { ...receipt, kind, counts: scopedPlan.counts } : url.endsWith('/preview') ? scopedPlan : { items: [{ id: 7, name: 'Fictional Record' }], total: 1 })
    }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Cleanup scope'), { target: { value: kind } })
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: kind === 'campaign' ? 'Find campaigns' : 'Find templates' }))
    await screen.findByRole('option', { name: 'Fictional Record' })
    fireEvent.change(screen.getByLabelText(kind === 'campaign' ? 'Campaign to remove' : 'Template to remove'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByRole('heading', { name: 'Removal preview' })
    expect(requests.find(({ url }) => url.endsWith('/preview'))?.body).toEqual({ kind, [`${kind}_id`]: 7 })
    expect(screen.getByText(kind === 'campaign' ? /affected identities become do-not-contact/ : /Existing draft text, approvals and conversation history remain/)).toBeVisible()
    if (kind === 'template') expect(screen.getByText('Template links cleared')).toBeVisible()
    else expect(screen.getByText('Fictional Retained Contact')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    await screen.findByText(kind === 'campaign' ? /Campaigns removed: 1/ : /Templates removed: 1/)
    expect(screen.queryByText('Fictional Record')).not.toBeInTheDocument()
    expect(requests.filter(({ url }) => url.endsWith('/confirm'))).toHaveLength(1)
  })

  it('clears stale campaign selections and search on switching to templates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [{ id: 7, name: 'Fictional Campaign' }], total: 1 })))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Cleanup scope'), { target: { value: 'campaign' } })
    fireEvent.change(screen.getByLabelText('Search campaigns for removal'), { target: { value: 'Fictional' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find campaigns' }))
    await screen.findByRole('option', { name: 'Fictional Campaign' })
    fireEvent.change(screen.getByLabelText('Campaign to remove'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Cleanup scope'), { target: { value: 'template' } })
    expect(screen.getByLabelText('Search templates for removal')).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Fictional Campaign' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeDisabled()
  })

  it('shows Dutch campaign/template receipt types and controls without translating authored names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [
      { ...receipt, kind: 'campaign', counts: { ...receipt.counts, prospects: 0, campaigns: 1 } },
      { ...receipt, plan_id: 'b'.repeat(32), kind: 'template', counts: { ...receipt.counts, prospects: 0, templates: 1 } },
    ] })))
    render(<I18nProvider initialLocale="nl"><PrivacyControls retentionDays={365} onSaved={vi.fn()} /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('Wat wil je opschonen?'), { target: { value: 'campaign' } })
    expect(screen.getByRole('button', { name: 'Campagnes zoeken' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderingsbevestigingen bekijken' }))
    await screen.findByText(/Verwijderde campagnes: 1/)
    await screen.findByText(/Verwijderde sjablonen: 1/)
  })

  it('previews counts without deleting and cancellation clears the password', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { requests.push(url); return response(plan) }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    expect(within(dialog).getByRole('button', { name: 'Confirm removal' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(requests).toEqual(['/api/privacy/preview'])
    fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
    expect(screen.getByLabelText('Local account password')).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('binds confirmation to the exact plan and prevents a duplicate pending submission', async () => {
    let submitted: unknown
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/confirm')) { submitted = JSON.parse(String(options.body)); return pending }
      return response(plan)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    const form = within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(1)
    expect(submitted).toEqual({ plan_id: plan.plan_id, current_password: 'fictional secret', confirmed: true })
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    release(response(receipt))
    await screen.findByText(/Recovery file: fictional-recovery.db/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Fictional Person')).not.toBeInTheDocument()
  })

  it.each(['privacy_preview_changed', 'privacy_preview_expired', 'privacy_preview_required'])('requires a fresh preview after %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/confirm') ? response({ error: { code, message: 'Records changed after the preview; create a new preview' } }, 409) : response(plan)))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    await screen.findByText('Records changed after the preview; create a new preview')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review removal' })).not.toBeInTheDocument()
  })

  it('keeps the same preview on a transport interruption and clears password and acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.endsWith('/confirm')) throw new TypeError('fictional transport loss'); return response(plan) }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    await within(dialog).findByText(/local service is unavailable/)
    expect(within(dialog).getByLabelText('Local account password')).toHaveValue('')
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
    expect(within(dialog).getByText(/retry this same preview/)).toBeVisible()
  })

  it('shows an error, not an empty successful preview, when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { code: 'unavailable', message: 'QA read failed' } }, 503)))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByText('QA read failed')
    expect(screen.queryByText('No contacts in this preview will be removed.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review removal' })).not.toBeInTheDocument()
  })

  it('clears the preview when selection changes, supports paging, and leaves authored names untouched', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url)
      return response(url.includes('/prospects') ? { items: [{ id: 7, name: 'Fictional Person', source_url: 'https://simbi.com/fictional' }], total: 70 } : plan)
    }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Cleanup scope'), { target: { value: 'prospect' } })
    expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Find contacts' }))
    await screen.findByRole('option', { name: /Fictional Person/ })
    fireEvent.change(screen.getByLabelText('Contact to remove'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByRole('heading', { name: 'Removal preview' })
    fireEvent.change(screen.getByLabelText('Search contacts for removal'), { target: { value: 'new search' } })
    expect(screen.queryByRole('heading', { name: 'Removal preview' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Find contacts' }))
    await screen.findByRole('option', { name: /Fictional Person/ })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(requests.some((url) => url.includes('offset=50') && url.includes('new%20search'))).toBe(true))
  })

  it('renders the privacy controls and receipt recovery in Dutch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [receipt] })))
    render(<I18nProvider initialLocale="nl"><PrivacyControls retentionDays={365} onSaved={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole('heading', { name: 'Privacy en opschonen' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderingsbevestigingen bekijken' }))
    await screen.findByText(/Herstelbestand: fictional-recovery.db/)
  })
})
