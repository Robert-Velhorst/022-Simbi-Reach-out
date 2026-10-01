import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithRouter } from '../test/router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import type { Member } from '../types'

const member: Member = { user_id: 1, email: 'qa@example.test', display_name: 'QA', workspace_id: 1, workspace_name: 'QA workspace', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-01', paused_at: null, environment: 'test', demo_mode: false }
const emptyPage = { items: [], total: 0, limit: 50, offset: 0 }
const overview = { counts: { reviews: 0, due: 0, replies: 0, prospects: 0 }, queue: [], campaigns: [], reminders: [], events: [] }
const report = { funnel: { total: 0 }, campaigns: [], generated_at: '2026-10-01', local_only: true }
const routes = [
  ['/', '/overview', 'overview', 'Your queue is clear', overview],
  ['/prospects', '/prospects', 'prospects', 'No prospects', emptyPage],
  ['/campaigns', '/campaigns', 'campaigns', 'No campaigns', emptyPage],
  ['/templates', '/templates', 'templates', 'No templates', emptyPage],
  ['/review', '/drafts', 'drafts', 'No drafts to review', emptyPage],
  ['/replies', '/replies', 'replies', 'No replies recorded', emptyPage],
  ['/reminders', '/reminders', 'reminders', 'No open reminders', emptyPage],
  ['/audit', '/audit', 'audit events', 'No events yet', emptyPage],
  ['/reports', '/reports/summary', 'reports', 'No report data', report],
] as const

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function show(path: string) {
  return renderWithRouter(<AppShell member={member} onMemberChange={() => {}} onSignedOut={() => {}} />, [path])
}

describe('truthful loading states on every operational route', () => {
  it.each(routes)('%s waits for an actual successful response before declaring an empty result', async (path, endpoint, label, emptyTitle, payload) => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => new URL(url, 'http://localhost').pathname === `/api${endpoint}`
      ? new Promise<Response>((finish) => { resolve = finish }) : Promise.resolve(Response.json(emptyPage))))
    show(path)
    expect(screen.getByText(`Loading ${label}…`)).toBeVisible()
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument()
    if (path === '/') expect(screen.queryByRole('link', { name: 'Review 0 drafts' })).not.toBeInTheDocument()
    if (path === '/reports') expect(document.querySelector('.metric-rail')).not.toBeInTheDocument()
    await act(async () => { resolve(Response.json(payload)) })
    expect(await screen.findByText(emptyTitle)).toBeVisible()
    expect(screen.queryByText(`Loading ${label}…`)).not.toBeInTheDocument()
  })

  it.each(routes)('%s distinguishes failure from emptiness and can retry', async (path, endpoint, label, emptyTitle, payload) => {
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (new URL(url, 'http://localhost').pathname !== `/api${endpoint}`) return Response.json(emptyPage)
      return ++reads === 1 ? Response.json({ error: { code: 'temporary', message: 'Fictional read failure' } }, { status: 503 }) : Response.json(payload)
    }))
    show(path)
    expect(await screen.findByText('Fictional read failure')).toBeVisible()
    expect(screen.getByText(`No result is available for ${label}.`)).toBeVisible()
    expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(emptyTitle)).toBeVisible()
    expect(screen.queryByText('Fictional read failure')).not.toBeInTheDocument()
    expect(reads).toBe(2)
  })
})

it('labels retained report values as stale during refresh and after failure, then recovers', async () => {
  let resolve!: (value: Response) => void
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(() => ++reads === 1
    ? Promise.resolve(Response.json({ ...report, funnel: { total: 7 } }))
    : new Promise<Response>((finish) => { resolve = finish })))
  show('/reports')
  await waitFor(() => expect(document.querySelector('.metric-rail strong')).toHaveTextContent('7'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(screen.getByText('Refreshing reports… Showing the last loaded result.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  await act(async () => { resolve(Response.json({ error: { message: 'Refresh failed' } }, { status: 503 })) })
  expect(await screen.findByText('Showing the last loaded result; it may be out of date.')).toBeVisible()
  expect(document.querySelector('.metric-rail strong')).toHaveTextContent('7')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await act(async () => { resolve(Response.json(report)) })
  await waitFor(() => expect(document.querySelector('.metric-rail strong')).toHaveTextContent('0'))
  expect(screen.queryByText('Refresh failed')).not.toBeInTheDocument()
})
