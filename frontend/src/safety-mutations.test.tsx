import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post } from './api'
import SettingsPage from './pages/Settings'
import { fictionalMember, operationalReads } from './test/operational-reads'
import type { Member } from './types'
import { validSafetyMutation } from './safetyMutations'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const timestamp = '2026-10-02T12:00:00Z'
const compliance = { reviewed_simbi_terms: true, confirmed_no_scraping: true, confirmed_manual_send: true, confirmed_suppression_process: true }
const provider = { provider: 'Simbi', base_url: 'https://simbi.com/' }
const cases: Array<[string, unknown, unknown]> = [
  ['/settings/pause', { paused: true }, {}],
  ['/settings/pause', { paused: true }, { paused: false, paused_at: null }],
  ['/settings/pause', { paused: true }, { paused: true, paused_at: null }],
  ['/settings/pause', { paused: true }, { paused: true, paused_at: 'not a date' }],
  ['/settings/pause', { paused: false }, { paused: false, paused_at: timestamp }],
  ['/settings/pause', { paused: true }, { paused: 1, paused_at: timestamp }],
  ['/settings/compliance', compliance, {}],
  ['/settings/compliance', compliance, { compliance_ack_at: null }],
  ['/settings/compliance', compliance, { compliance_ack_at: 'yesterday' }],
  ['/settings/provider', provider, {}],
  ['/settings/provider', provider, { ...provider, provider: 'other', mode: 'assisted', verified: false }],
  ['/settings/provider', provider, { ...provider, provider: 'simbi', base_url: 'https://other.example/', mode: 'assisted', verified: false }],
  ['/settings/provider', provider, { ...provider, provider: 'simbi', mode: 'automatic', verified: false }],
  ['/settings/provider', provider, { ...provider, provider: 'simbi', mode: 'assisted', verified: true }],
]

describe('actual client safety mutation confirmations', () => {
  it.each(cases)('refuses an unverified %s confirmation: %j => %j', async (path, body, result) => {
    const fetcher = vi.fn(async () => Response.json(result))
    vi.stubGlobal('fetch', fetcher)
    await expect(post(path, body)).rejects.toMatchObject({ code: 'response_unverified', message: expect.stringContaining('may already have changed local records') })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['/settings/pause', { paused: true }, { paused: true, paused_at: timestamp }],
    ['/settings/pause', { paused: false }, { paused: false, paused_at: null }],
    ['/settings/compliance', compliance, { compliance_ack_at: timestamp }],
    ['/settings/provider', provider, { ...provider, provider: 'simbi', mode: 'assisted', verified: false }],
  ] as Array<[string, unknown, unknown]>)('preserves the real %s confirmation', async (path, body, result) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(result)))
    expect(await post(path, body)).toEqual(result)
  })
})

it.each([
  [' https://SIMBI.com:443/services?q=one#fragment ', 'https://simbi.com/services?q=one'],
  ['https://simbi.com', 'https://simbi.com'],
  ['https://simbi.com/path%20name', 'https://simbi.com/path%20name'],
  ['https://simbi.com/é', 'https://simbi.com/é'],
  ['https://simbi.com/services?q=one?', 'https://simbi.com/services?q=one?'],
  ['https://simbi.com/services?', 'https://simbi.com/services'],
  ['https://simbi.com/services;', 'https://simbi.com/services'],
  ['https://simbi.com/services;;', 'https://simbi.com/services;;'],
  ['https://simbi.com:0443/', 'https://simbi.com/'],
  ['https://simbi.com:/', 'https://simbi.com/'],
] as const)('preserves server provider normalization for %s', async (base_url, normalized) => {
  const result = { provider: 'simbi', base_url: normalized, mode: 'assisted', verified: false, extra: 'preserved' }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result)))
  expect(await post('/settings/provider', { provider: 'Simbi', base_url })).toEqual(result)
})

it.each(['http://simbi.com/', 'https://user:pass@simbi.com/', 'https://simbi.com:8443/', 'https://simbi.com\\other/', 'https://simbi.com/\nprivate'])('does not verify an unsafe submitted provider link %s', async (base_url) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ provider: 'simbi', base_url, mode: 'assisted', verified: false })))
  await expect(post('/settings/provider', { provider: 'simbi', base_url })).rejects.toMatchObject({ code: 'response_unverified' })
})

it('limits this contract to the three inspected POST routes and refuses unreadable request bodies', () => {
  expect(validSafetyMutation('/settings', 'GET', undefined, {})).toBe(true)
  expect(validSafetyMutation('/settings/team', 'POST', '{}', {})).toBe(true)
  expect(validSafetyMutation('/settings/pause', 'POST', '{', {})).toBe(false)
  expect(validSafetyMutation('/settings/pause', 'POST', '[]', {})).toBe(false)
})

it('does not claim the safety stop is enabled after an empty successful confirmation', async () => {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/settings/pause' && options.method === 'POST') { writes.push(JSON.parse(String(options.body))); return Response.json({}) }
    return Response.json(url === '/api/me' ? fictionalMember : operationalReads['/settings'])
  }))
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Enable safety stop' }))
  expect(await screen.findByText(/may already have changed local records/)).toBeVisible()
  expect(screen.queryByText('Safety stop enabled. New approvals and handoffs are blocked.')).not.toBeInTheDocument()
  expect(screen.queryByText('The workspace is operating under its normal approval gates.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enable safety stop' })).toBeDisabled()
  expect(writes).toEqual([{ paused: true }])
})

it('does not claim success when a valid stop confirmation is contradicted by the follow-up reads', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/settings/pause' && options.method === 'POST') return Response.json({ paused: true, paused_at: timestamp })
    return Response.json(url === '/api/me' ? fictionalMember : operationalReads['/settings'])
  }))
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Enable safety stop' }))
  expect(await screen.findByText(/Settings could not be verified/)).toBeVisible()
  expect(screen.queryByText('Safety stop enabled. New approvals and handoffs are blocked.')).not.toBeInTheDocument()
})

it('blocks a repeated safety-stop click while its confirmation is pending', async () => {
  let finish!: (value: Response) => void
  const pending = new Promise<Response>(resolve => { finish = resolve })
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/settings/pause' && options.method === 'POST') { writes.push(JSON.parse(String(options.body))); return pending }
    const paused_at = writes.length ? timestamp : null
    return Response.json(url === '/api/me' ? { ...fictionalMember, paused_at } : { ...operationalReads['/settings'], workspace: { ...operationalReads['/settings'].workspace, paused_at } })
  }))
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  const button = await screen.findByRole('button', { name: 'Enable safety stop' })
  fireEvent.click(button); fireEvent.click(button)
  const wasDisabled = (button as HTMLButtonElement).disabled
  expect(screen.queryByText('The workspace is operating under its normal approval gates.')).not.toBeInTheDocument()
  expect(screen.getByText('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.')).toBeVisible()
  await act(async () => { finish(Response.json({ paused: true, paused_at: timestamp })) })
  await screen.findByText('Safety stop enabled. New approvals and handoffs are blocked.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume guarded workflow' })).toBeEnabled())
  expect(writes).toEqual([{ paused: true }])
  expect(wasDisabled).toBe(true)
})
