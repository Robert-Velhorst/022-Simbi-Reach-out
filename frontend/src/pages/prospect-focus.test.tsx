import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProspectsPage } from './Resources'

const person = { id: 1, name: 'Fictional focus person', source_url: 'https://simbi.com/never-send-focus', provider: 'simbi', organization: '', contact_handle: '', notes: '', consent_status: 'consented', created_at: '2026-10-01T12:00:00Z' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function service(fail = false) {
  let stopped = false
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/suppressions' && options.method === 'POST') {
      writes.push(JSON.parse(String(options.body)))
      if (fail) return response({ error: { code: 'service_unavailable', message: 'The stop could not be recorded.' } }, 503)
      stopped = true
      return response({ status: 'suppressed' }, 201)
    }
    return response({ items: [{ ...person, consent_status: stopped ? 'opted_out' : 'consented' }], total: 1, offset: 0, limit: 50 })
  }))
  return writes
}

async function openStop() {
  const trigger = await screen.findByRole('button', { name: 'Stop contact' })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger, dialog: await screen.findByRole('dialog', { name: `Stop contact: ${person.name}` }) }
}

describe('personal stop-contact return focus', () => {
  it('focuses the named prospects region after a successful stop disables its trigger', async () => {
    const writes = service()
    render(<ProspectsPage canEdit />)
    const { trigger, dialog } = await openStop()
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Fictional keyboard stop reason' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm stop contact' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toBeDisabled())
    expect(screen.getByRole('region', { name: 'Prospects' })).toHaveFocus()
    expect(writes).toEqual([{ prospect_id: person.id, reason: 'Fictional keyboard stop reason' }])
  })

  it('keeps ordinary cancellation on its still-enabled trigger without a write', async () => {
    const writes = service()
    render(<ProspectsPage canEdit />)
    const { trigger, dialog } = await openStop()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(trigger).toBeEnabled()
    expect(trigger).toHaveFocus()
    expect(writes).toEqual([])
  })

  it('retains the dialog and reason after a rejected confirmation instead of moving focus out', async () => {
    const writes = service(true)
    render(<ProspectsPage canEdit />)
    const { dialog } = await openStop()
    const reason = within(dialog).getByLabelText('Reason')
    fireEvent.change(reason, { target: { value: 'Preserve this fictional reason' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm stop contact' }))
    await within(dialog).findByText(/may already have changed local records.*before retrying/)
    expect(dialog).toBeInTheDocument()
    expect(reason).toHaveValue('Preserve this fictional reason')
    expect(writes).toEqual([{ prospect_id: person.id, reason: 'Preserve this fictional reason' }])
  })
})
