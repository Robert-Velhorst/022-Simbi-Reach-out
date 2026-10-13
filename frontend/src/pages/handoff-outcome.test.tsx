import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithDraftGuard as render } from '../test/router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewQueue from './ReviewQueue'
import type { Draft, Member } from '../types'

const member: Member = { user_id: 1, email: 'owner@example.test', display_name: 'Owner', workspace_id: 1, workspace_name: 'Personal fixture', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-02T12:00:00Z', paused_at: null, environment: 'test', demo_mode: false }
const original: Draft = { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Fictional Person', organization: '', source_url: 'https://simbi.com/fictional', consent_status: 'consented', campaign_name: 'Fictional campaign', template_name: 'Fictional template', subject: 'Reviewed subject', body: 'Reviewed message for this fictional conversation.', state: 'handoff_created', quality_score: 100, content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64), safety_flags: [], updated_at: '2026-10-02T12:00:00Z' }
const handoff = { id: 10, draft_id: 1, subject: original.subject, body: original.body, status: 'prepared', provider_url: original.source_url, instruction: 'Send manually', can_open_provider: true }
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const page = (items: unknown[]) => ({ items, total: items.length, offset: 0, limit: 50 })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function service(write: () => Promise<Response> | Response, readHandoffs: () => unknown[] = () => [handoff]) {
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/outcome')) { writes.push(String(options.body)); return write() }
    if (url.includes('/handoffs?')) return response({ items: readHandoffs() })
    return response(page(url.startsWith('/api/drafts?') ? [original] : []))
  }))
  return writes
}

async function openHandoff() {
  render(<ReviewQueue member={member} onMemberChange={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve latest handoff' }))
  return screen.findByRole('dialog', { name: 'Manual provider handoff' })
}

describe('personal manual-outcome confirmation', () => {
  it.each([{}, { unexpected: true }])('keeps the handoff and warning after damaged success %j', async receipt => {
    const writes = service(() => response(receipt))
    const dialog = await openHandoff()
    const message = within(dialog).getByLabelText('Approved message')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await within(dialog).findByText(/request outcome is not confirmed/i)).toBeVisible()
    expect(screen.getByRole('dialog', { name: 'Manual provider handoff' })).toBe(dialog)
    expect(within(dialog).getByLabelText('Approved message')).toBe(message)
    expect(message).toHaveValue(`${original.subject}\n\n${original.body}`)
  })

  it('refuses two synchronous outcome submissions before a render', async () => {
    let complete!: (value: Response) => void
    const writes = service(() => new Promise(resolve => { complete = resolve }))
    const dialog = await openHandoff()
    const submit = within(dialog).getByRole('button', { name: 'Sent manually' })
    act(() => { submit.click(); submit.click() })
    expect(writes).toHaveLength(1)
    expect(submit).toBeDisabled()
    await act(async () => { complete(response({})); await Promise.resolve() })
  })

  it('blocks a blind repeat after an unverified outcome', async () => {
    const writes = service(() => response({}))
    const dialog = await openHandoff()
    const submit = within(dialog).getByRole('button', { name: 'Sent manually' })
    fireEvent.click(submit)
    await within(dialog).findByText(/request outcome is not confirmed/i)
    fireEvent.click(submit)
    expect(writes).toHaveLength(1)
    expect(submit).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Check saved outcome' })).toBeEnabled()
  })

  it.each([
    ['Sent manually', 'sent', 'sent'],
    ['Unsure — needs verification', 'ambiguous', 'ambiguous'],
    ['Not sent', 'cancelled', 'approved'],
  ])('accepts only a matching %s receipt with additive fields', async (label, status, draft_state) => {
    const writes = service(() => response({ status, draft_state, additional: true }))
    const dialog = await openHandoff()
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes.map(body => JSON.parse(body))).toEqual([{ outcome: status }])
  })

  it.each([
    { status: 'sent' },
    { status: 'sent', draft_state: 'approved' },
    { status: 'cancelled', draft_state: 'approved' },
    { status: true, draft_state: 'sent' },
    [{ status: 'sent', draft_state: 'sent' }],
  ].map(receipt => ({ receipt })))('refuses a contradictory sent receipt %j', async ({ receipt }) => {
    const writes = service(() => response(receipt))
    const dialog = await openHandoff()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    await within(dialog).findByText(/request outcome is not confirmed/i)
    expect(within(dialog).getByRole('button', { name: 'Sent manually' })).toBeDisabled()
    expect(writes).toHaveLength(1)
  })

  it('recovers a committed sent record with a read only and retains the original message', async () => {
    let committed = false
    const writes = service(() => { committed = true; return response({}) }, () => [{ ...handoff, status: committed ? 'sent' : 'prepared', can_open_provider: !committed }])
    const dialog = await openHandoff()
    const message = within(dialog).getByLabelText('Approved message')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check saved outcome' }))
    expect(await within(dialog).findByText('Saved handoff status: sent. This is a local record, not proof of delivery.')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Sent manually' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Not sent' })).toBeDisabled()
    expect(within(dialog).getByLabelText('Approved message')).toBe(message)
    expect(message).toHaveValue(`${original.subject}\n\n${original.body}`)
    expect(writes).toHaveLength(1)
  })

  it.each([
    [],
    [{ ...handoff, id: 11 }],
    [{ ...handoff, status: 'unsupported' }],
    [{ ...handoff, subject: 'Different message' }],
    [handoff, handoff],
  ].map(saved => ({ saved })))('keeps uncertainty after an inconclusive saved-outcome read %j', async ({ saved }) => {
    let wrote = false
    const writes = service(() => { wrote = true; return response({}) }, () => wrote ? saved : [handoff])
    const dialog = await openHandoff()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    const check = await within(dialog).findByRole('button', { name: 'Check saved outcome' })
    fireEvent.click(check)
    await waitFor(() => expect(check).toBeEnabled())
    expect(within(dialog).getByRole('button', { name: 'Sent manually' })).toBeDisabled()
    expect(within(dialog).queryByText(/Saved handoff status:/)).not.toBeInTheDocument()
    expect(writes).toHaveLength(1)
  })

  it('allows a new deliberate decision only after a verified pending-state read', async () => {
    let attempted = false
    const writes = service(() => { const prior = attempted; attempted = true; return response(prior ? { status: 'cancelled', draft_state: 'approved' } : {}) })
    const dialog = await openHandoff()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check saved outcome' }))
    await within(dialog).findByText('Saved handoff status: prepared. This is a local record, not proof of delivery.')
    const cancel = within(dialog).getByRole('button', { name: 'Not sent' })
    expect(cancel).toBeEnabled()
    expect(writes).toHaveLength(1)
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes.map(body => JSON.parse(body))).toEqual([{ outcome: 'sent' }, { outcome: 'cancelled' }])
  })

  it('retains uncertainty when the same handoff is closed and reopened on this page', async () => {
    const writes = service(() => response({}))
    const dialog = await openHandoff()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sent manually' }))
    await within(dialog).findByText(/request outcome is not confirmed/i)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve latest handoff' }))
    const reopened = await screen.findByRole('dialog', { name: 'Manual provider handoff' })
    expect(within(reopened).getByRole('button', { name: 'Sent manually' })).toBeDisabled()
    expect(within(reopened).getByRole('button', { name: 'Check saved outcome' })).toBeEnabled()
    expect(writes).toHaveLength(1)
  })
})
