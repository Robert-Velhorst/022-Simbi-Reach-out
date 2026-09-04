import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuditPage, RemindersPage, RepliesPage } from './Operations'

const reply = (id: number) => ({ id, draft_id: id, prospect_name: `Person ${id}`, campaign_name: 'Campaign', body: `Reply ${id}`, received_at: '2026-09-05T12:00:00Z', direction: 'inbound' })
const reminder = (id: number) => ({ id, title: `Reminder ${id}`, due_at: '2026-09-05T12:00:00Z', status: 'open', prospect_name: `Person ${id}`, campaign_name: 'Campaign' })
const audit = (id: number) => ({ id, event_type: `Event ${id}`, entity_type: 'draft', entity_id: String(id), display_name: 'Owner', created_at: '2026-09-05T12:00:00Z' })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it.each([['Replies', RepliesPage, 'Record reply'], ['Reminders', RemindersPage, 'New reminder']] as const)('refreshes the %s conversation selector on opening and lets failed reads retry', async (_name, Component, openButton) => {
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/drafts')) {
      reads++
      if (reads === 2) return response({ error: { code: 'temporary', message: 'Conversation load failed' } }, 503)
      return response({ items: [], total: 0, limit: 50, offset: 0 })
    }
    return response({ items: [], total: 0, limit: 50, offset: 0 })
  }))
  render(<Component />)
  await waitFor(() => expect(reads).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: openButton }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Conversation load failed')).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry conversations' }))
  await waitFor(() => expect(reads).toBe(3))
  await waitFor(() => expect(within(dialog).queryByText('Conversation load failed')).not.toBeInTheDocument())
})

it.each([
  ['replies', RepliesPage, reply, 'Reply'],
  ['reminders', RemindersPage, reminder, 'Reminder'],
  ['audit', AuditPage, audit, 'Event'],
] as const)('navigates bounded %s pages and preserves a failed page for retry', async (route, Component, item, label) => {
  const requests: URLSearchParams[] = []
  let failNext = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/drafts') return response({ items: [], total: 0, limit: 50, offset: 0 })
    expect(parsed.pathname).toBe(`/api/${route}`)
    requests.push(parsed.searchParams)
    const offset = Number(parsed.searchParams.get('offset') ?? 0)
    if (offset === 50 && failNext) { failNext = false; return response({ error: { code: 'temporary', message: 'Page temporarily unavailable' } }, 503) }
    return response({ items: [item(offset + 1)], total: 51, limit: 50, offset })
  }))
  render(<Component />)
  await screen.findByText(`${label} 1`)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(await screen.findByText('Page temporarily unavailable')).toBeVisible()
  expect(screen.getByText(`${label} 1`)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(await screen.findByText(`${label} 51`)).toBeVisible()
  expect(screen.queryByText(`${label} 1`)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  expect(await screen.findByText(`${label} 1`)).toBeVisible()
  expect(requests.map((query) => query.get('offset'))).toEqual(['0', '50', '50', '0'])
  expect(requests.every((query) => query.get('limit') === '50')).toBe(true)
  if (route === 'reminders') expect(requests.every((query) => query.get('status') === 'open')).toBe(true)
})

it('refreshes open reminders after completion on a later page', async () => {
  let completed = false
  const offsets: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/drafts') return response({ items: [], total: 0, limit: 50, offset: 0 })
    if (options.method === 'PATCH') { completed = true; return response({ ...reminder(51), status: 'done' }) }
    const offset = Number(parsed.searchParams.get('offset') ?? 0)
    offsets.push(offset)
    return response({ items: completed ? [] : [reminder(offset + 1)], total: completed ? 50 : 51, limit: 50, offset })
  }))
  render(<RemindersPage />)
  await screen.findByText('Reminder 1')
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByText('Reminder 51')
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByText('Reminder 51')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  expect(completed).toBe(true)
  expect(offsets).toEqual([0, 50, 50])
})
