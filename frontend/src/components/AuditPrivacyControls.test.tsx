import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import AuditPrivacyControls from './AuditPrivacyControls'
import PrivacyControls from './PrivacyControls'

const plan = { kind: 'audit_redaction', plan_id: 'a'.repeat(32), expires_at: '2030-01-01T00:00:00Z', cutoff: '2025-01-01T00:00:00Z', retention_days: 365, counts: { audit_events: 1 }, events: [{ id: 7, event_type: 'prospect.suppressed', entity_type: 'prospect', entity_id: '9', created_at: '2020-01-01T00:00:00Z', fields: ['reason'] }], after_id: 0, scanned_events: 3, protected_events: 1, unchanged_events: 1, remaining_eligible_events: 0, has_more_events: false, next_after_id: null }
const receipt = { kind: 'audit_redaction', plan_id: plan.plan_id, counts: plan.counts, backup_file: 'fictional-recovery.db', completed_at: '2026-10-01T10:00:00Z', replayed: false }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview old audit details' }))
  await screen.findByRole('heading', { name: 'Audit detail preview' })
  fireEvent.click(screen.getByRole('button', { name: 'Review audit minimization' }))
  return screen.getByRole('dialog', { name: 'Confirm audit minimization' })
}
function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('checkbox'))
  fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
  const form = within(dialog).getByRole('button', { name: 'Confirm audit update' }).closest('form')!
  fireEvent.submit(form)
  return form
}

describe('owner audit minimization controls', () => {
  it('previews exact event identifiers and fields; cancelling clears credentials and acknowledgement', async () => {
    const fetchMock = vi.fn(async () => response(plan))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuditPrivacyControls />)
    const dialog = await open()
    expect(screen.getByText(/Event 7: prospect.suppressed; prospect 9/)).toHaveTextContent('Duplicate restriction reason')
    expect(within(dialog).getByRole('button', { name: 'Confirm audit update' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Local account password'), { target: { value: 'fictional secret' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Review audit minimization' }))
    expect(screen.getByLabelText('Local account password')).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('pins confirmation to the exact preview and guards duplicate pending submissions', async () => {
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const requests: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => { if (url.endsWith('/confirm')) { requests.push(JSON.parse(String(options?.body))); return pending }; return response(plan) }))
    render(<AuditPrivacyControls />)
    const dialog = await open()
    const form = submit(dialog)
    fireEvent.submit(form)
    expect(requests).toEqual([{ plan_id: plan.plan_id, current_password: 'fictional secret', confirmed: true }])
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    release(response(receipt))
    await screen.findByText(/Events updated: 1. Recovery file: fictional-recovery.db/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audit detail preview' })).not.toBeInTheDocument()
  })

  it.each(['privacy_preview_required', 'privacy_preview_changed', 'privacy_preview_expired'])('discards a %s plan without claiming completion', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/confirm') ? { error: { code, message: 'Records changed after the preview; create a new preview' } } : plan, url.endsWith('/confirm') ? 409 : 200)))
    render(<AuditPrivacyControls />)
    submit(await open())
    await screen.findByText('Records changed after the preview; create a new preview')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Events updated:/)).not.toBeInTheDocument()
  })

  it.each(['network', 'backup'])('keeps the plan for a %s failure and clears the password', async (mode) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.endsWith('/confirm')) return response(plan)
      if (mode === 'network') throw new TypeError('fictional lost response')
      return response({ error: { code: 'privacy_backup_failed', message: 'Recovery backup could not be verified; no cleanup was performed' } }, 503)
    }))
    render(<AuditPrivacyControls />)
    const dialog = await open()
    submit(dialog)
    await within(dialog).findByText(mode === 'network' ? 'Audit minimization is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.' : 'Recovery backup could not be verified; no cleanup was performed')
    expect(within(dialog).getByLabelText('Local account password')).toHaveValue('')
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('heading', { name: 'Audit detail preview' })).toBeInTheDocument()
    expect(screen.queryByText(/Events updated:/)).not.toBeInTheDocument()
  })

  it.each([{ ...receipt, plan_id: 'b'.repeat(32) }, { ...receipt, kind: 'retention' }, { ...receipt, counts: { audit_events: 2 } }, { ...receipt, backup_file: '../private.db' }, { ...receipt, completed_at: 'invalid' }])('does not trust an unrelated or malformed completion receipt', async (invalid) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/confirm') ? invalid : plan)))
    render(<AuditPrivacyControls />)
    submit(await open())
    await screen.findByText('Audit minimization is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.')
    expect(screen.queryByText(/Events updated:/)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not allow a malformed preview to enable confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, events: [{ ...plan.events[0], fields: ['unknown'] }] })))
    render(<AuditPrivacyControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview old audit details' }))
    await screen.findByText('The audit preview could not be verified; no confirmation is available.')
    expect(screen.queryByRole('button', { name: 'Review audit minimization' })).not.toBeInTheDocument()
  })

  it('continues a bounded scan without claiming the entire history is clean', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)); bodies.push(body)
      return response({ ...plan, after_id: body.after_id, counts: { audit_events: 0 }, events: [], has_more_events: body.after_id === 0, next_after_id: body.after_id === 0 ? 1000 : null })
    }))
    render(<AuditPrivacyControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview old audit details' }))
    await screen.findByText('No eligible duplicate text was selected on this scan page. This does not mean all history is free of personal data.')
    expect(screen.getByRole('button', { name: 'Review audit minimization' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next audit scan page' }))
    await screen.findByRole('button', { name: 'Restart audit scan' })
    expect(bodies).toEqual([{ after_id: 0 }, { after_id: 1000 }])
    fireEvent.click(screen.getByRole('button', { name: 'Restart audit scan' }))
    await screen.findByRole('button', { name: 'Next audit scan page' })
    expect(bodies.at(-1)).toEqual({ after_id: 0 })
  })

  it('shows Dutch exact-field and receipt text while leaving event types unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/receipts') ? { items: [receipt] } : plan)))
    render(<I18nProvider initialLocale="nl"><AuditPrivacyControls /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Oude logdetails vooraf bekijken' }))
    await screen.findByText(/Gebeurtenis 7: prospect.suppressed; prospect 9/)
    expect(screen.getByText(/Velden: Dubbele reden voor contactbeperking/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigingen van logbeperking bekijken' }))
    await screen.findByText(/Bijgewerkte gebeurtenissen: 1/)
  })

  it('labels audit receipts correctly in the shared cleanup receipt history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [receipt] })))
    render(<PrivacyControls retentionDays={365} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check cleanup receipts' }))
    await screen.findByText(/Events updated: 1/)
    expect(screen.queryByText(/Contacts removed:/)).not.toBeInTheDocument()
  })
})
