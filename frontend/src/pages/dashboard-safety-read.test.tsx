import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
import { fictionalMember, operationalReads } from '../test/operational-reads'
import type { Member } from '../types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const member = { ...fictionalMember, compliance_ack_at: '2026-10-01T12:00:00Z' } as Member

it('does not declare backup or privacy verification from a pending overview read', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  render(<MemoryRouter><Dashboard member={member} /></MemoryRouter>)
  expect(screen.queryByText('SQLite + backups')).not.toBeInTheDocument()
  expect(screen.queryByText('On-device only')).not.toBeInTheDocument()
  expect(screen.queryByText('Acknowledged')).not.toBeInTheDocument()
  expect(screen.getByText('Loading overview…')).toBeVisible()
})

it('uses the verified overview policy state rather than a stale member snapshot', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(operationalReads['/overview'])))
  render(<MemoryRouter><Dashboard member={member} /></MemoryRouter>)
  await screen.findByText('Your queue is clear')
  const safety = screen.getByRole('region', { name: 'Safety and compliance status' })
  expect(within(safety).getByText('Required')).toBeVisible()
  expect(within(safety).queryByText('Acknowledged')).not.toBeInTheDocument()
})
