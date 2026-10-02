import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsPage from './Settings'
import { fictionalMember, operationalReads } from '../test/operational-reads'
import type { Member } from '../types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('does not claim normal safety gates or enable a safety mutation before the first settings read is verified', async () => {
  let finish!: (response: Response) => void
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetcher)
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  expect(screen.queryByText('The workspace is operating under its normal approval gates.')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Enable safety stop' })).not.toBeInTheDocument()
  expect(screen.getByText('Loading settings…')).toBeVisible()
  await act(async () => { finish(Response.json({ ...operationalReads['/settings'], workspace: { ...operationalReads['/settings'].workspace, paused_at: '2026-10-02T12:00:00Z' } })) })
  expect(await screen.findByRole('button', { name: 'Resume guarded workflow' })).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('distinguishes an unavailable settings read from a normal safety state', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'fictional_read_failure', message: 'Fictional settings read unavailable' } }, { status: 503 })))
  render(<SettingsPage member={fictionalMember as Member} onMemberChange={() => {}} />)
  expect(await screen.findByText('Fictional settings read unavailable')).toBeVisible()
  expect(screen.queryByText('The workspace is operating under its normal approval gates.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Enable safety stop' })).not.toBeInTheDocument()
})
