import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import PrivacyControls from './PrivacyControls'

const plan = { kind: 'retention', plan_id: 'a'.repeat(32), expires_at: '2030-01-01T00:00:00Z', cutoff: '2025-01-01T00:00:00Z', retention_days: 365, counts: { prospects: 1, drafts: 2, handoffs: 1, replies: 3, reminders: 1 }, contacts: [{ id: 7, name: 'Fictional Person' }], protected_contacts: 4, remaining_eligible_contacts: 2, after_id: 0, scanned_contacts: 7, oversized_contacts: 0, has_more_contacts: false, next_after_id: null }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const receipt = { kind: 'retention', plan_id: plan.plan_id, counts: plan.counts, backup_file: 'fictional-recovery.db', completed_at: '2026-10-01T10:00:00Z', replayed: false }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openConfirmation() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
  await screen.findByText('Fictional Person')
  fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
  return screen.getByRole('dialog', { name: 'Confirm local removal' })
}

describe('personal cleanup controls', () => {
  it('recovers an exact older receipt without replacing a pending preview or sending a confirmation', async () => {
    const older = { ...receipt, plan_id: 'b'.repeat(32) }
    const fetchMock = vi.fn(async (url: string) => response(url.endsWith(older.plan_id) ? older : plan))
    vi.stubGlobal('fetch', fetchMock)
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByText(`Cleanup reference: ${plan.plan_id}.`)
    fireEvent.change(screen.getByLabelText('Cleanup reference'), { target: { value: older.plan_id } })
    fireEvent.submit(screen.getByRole('button', { name: 'Find cleanup receipt by reference' }).closest('form')!)
    await screen.findByText(`Cleanup reference: ${older.plan_id}.`)
    expect(screen.getByText(`Cleanup reference: ${plan.plan_id}.`)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review removal' })).toBeEnabled()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/privacy/preview', `/api/privacy/receipts/${older.plan_id}`])
  })

  it.each([null, { ...receipt, plan_id: 'c'.repeat(32) }])('rejects an unverifiable or different reference lookup %j', async (found) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(found)))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Cleanup reference'), { target: { value: receipt.plan_id } })
    fireEvent.submit(screen.getByRole('button', { name: 'Find cleanup receipt by reference' }).closest('form')!)
    await screen.findByText('Cleanup receipts could not be verified.')
    expect(screen.queryByText(/Cleanup recorded at/)).not.toBeInTheDocument()
  })

  it('explains a missing reference in Dutch without treating it as failed removal', async () => {
    const message = 'No completed cleanup receipt matches this reference. Absence is not proof of failure; do not start a replacement removal.'
    const fetchMock = vi.fn(async () => response({ error: { code: 'privacy_receipt_not_found', message } }, 404))
    vi.stubGlobal('fetch', fetchMock)
    render(<I18nProvider initialLocale="nl"><PrivacyControls retentionDays={365} onSaved={vi.fn()} /></I18nProvider>)
    fireEvent.change(screen.getByLabelText('Opschoonreferentie'), { target: { value: receipt.plan_id } })
    fireEvent.submit(screen.getByRole('button', { name: 'Opschoonbevestiging zoeken op referentie' }).closest('form')!)
    await screen.findByText(/Dat bewijst niet dat de verwijdering is mislukt/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Verwijdering controleren' })).not.toBeInTheDocument()
  })
  it.each([
    { kind: 'audit_redaction' }, { counts: { ...plan.counts, prospects: 2 } },
    { counts: { ...plan.counts, replies: 4 } }, { counts: { ...plan.counts, arbitrary: 1 } },
    { counts: null }, { backup_file: '../private.db' }, { backup_file: 'not-a-db.txt' },
    { completed_at: 'invalid' }, { completed_at: 0 }, { replayed: 'true' },
  ])('rejects malformed or unrelated completion receipts %j and keeps exact retry', async (changes) => {
    let attempt = 0
    const submissions: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.endsWith('/confirm')) return response(plan)
      submissions.push(JSON.parse(String(options?.body)))
      return response(attempt++ ? receipt : { ...receipt, ...changes })
    }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    const submit = () => {
      fireEvent.click(within(dialog).getByRole('checkbox'))
      fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
      fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    }
    submit()
    await within(dialog).findByText(/Cleanup is not confirmed/)
    expect(within(dialog).getByLabelText('Local account password')).toHaveValue('')
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
    expect(screen.queryByText(/Cleanup recorded at/)).not.toBeInTheDocument()
    submit()
    await screen.findByText(/Contacts removed: 1/)
    expect(submissions).toHaveLength(2)
    expect(submissions[0]).toEqual(submissions[1])
  })

  it.each([
    { kind: 'prospect' }, { after_id: 5 }, { scanned_contacts: 1001 },
    { scanned_contacts: 6 }, { oversized_contacts: 5 }, { contacts: [] },
    { contacts: [{ id: 0, name: 'invalid' }] }, { counts: { ...plan.counts, prospects: 51 } },
    { has_more_contacts: true, next_after_id: null }, { expires_at: 'invalid' },
  ])('does not expose confirmation for an unverifiable preview %j', async (changes) => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, ...changes })))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByText('The cleanup preview could not be verified; no confirmation is available.')
    expect(screen.queryByRole('button', { name: 'Review removal' })).not.toBeInTheDocument()
  })

  it('reaches a later page, preserves its cursor across confirmation, and restarts explicitly', async () => {
    const bodies: Array<{ kind: string; after_id?: number }> = []
    const empty = { ...plan, counts: { prospects: 0, drafts: 0, handoffs: 0, replies: 0, reminders: 0 }, contacts: [], scanned_contacts: 1000, protected_contacts: 1000, remaining_eligible_contacts: 0, has_more_contacts: true, next_after_id: 1000 }
    const later = { ...plan, contacts: [{ id: 1001, name: 'Fictional Person' }], after_id: 1000 }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/confirm')) return response(receipt)
      const body = JSON.parse(String(options?.body)); bodies.push(body)
      return response(body.after_id ? later : empty)
    }))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByRole('button', { name: 'Next contact scan page' })
    expect(screen.getByRole('button', { name: 'Review removal' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next contact scan page' }))
    await screen.findByText('Fictional Person')
    fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    await screen.findByText(/Contacts removed: 1/)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByText('Fictional Person')
    expect(bodies.at(-1)).toEqual({ kind: 'retention', after_id: 1000 })
    fireEvent.click(screen.getByRole('button', { name: 'Restart contact scan' }))
    await screen.findByRole('button', { name: 'Next contact scan page' })
    expect(bodies.at(-1)).toEqual({ kind: 'retention', after_id: 0 })
    expect(screen.queryByRole('button', { name: 'Restart contact scan' })).not.toBeInTheDocument()
  })

  it('does not let the next page skip selected eligible contacts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, has_more_contacts: true, next_after_id: 1000 })))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }))
    await screen.findByText('Fictional Person')
    expect(screen.getByRole('button', { name: 'Next contact scan page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review removal' })).toBeEnabled()
  })

  it('rejects malformed stored receipt lists without invented completion counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [{ ...receipt, counts: { prospects: 999 } }] })))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check cleanup receipts' }))
    await screen.findByText('Cleanup receipts could not be verified.')
    expect(screen.queryByText(/Contacts removed:/)).not.toBeInTheDocument()
  })

  it('renders truthful protected-page counts and continuation in Dutch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, has_more_contacts: true, next_after_id: 1000 })))
    render(<I18nProvider initialLocale="nl"><PrivacyControls retentionDays={365} onSaved={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Opschonen bekijken' }))
    await screen.findByText('Fictional Person')
    expect(screen.getByText(/Deze scanpagina: 7 gecontroleerd, 4 beschermd/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Volgende pagina van de contactscan' })).toBeDisabled()
  })
  it('does not claim completion from a different plan receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/confirm') ? { ...receipt, plan_id: 'b'.repeat(32) } : plan)))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    const dialog = await openConfirmation()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Confirm removal' }).closest('form')!)
    await within(dialog).findByText(/Cleanup is not confirmed/)
    expect(screen.queryByText(/Cleanup recorded at/)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Local account password')).toHaveValue('')
  })
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
      { ...receipt, kind: 'campaign', counts: { ...receipt.counts, prospects: 0, campaigns: 1, restricted_contacts: 1 } },
      { ...receipt, plan_id: 'b'.repeat(32), kind: 'template', counts: { prospects: 0, drafts: 0, handoffs: 0, replies: 0, reminders: 0, templates: 1, template_links: 2 } },
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
    await within(dialog).findByText(/Cleanup is not confirmed/)
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
      return response(url.includes('/prospects') ? { items: [{ id: 7, name: 'Fictional Person', source_url: 'https://simbi.com/fictional' }], total: 70 } : { ...plan, kind: 'prospect' })
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
