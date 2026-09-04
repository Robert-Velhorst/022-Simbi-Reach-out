import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Member } from '../types'
import Dashboard from './Dashboard'

const member: Member = {
  user_id: 1,
  email: 'owner@example.test',
  display_name: 'Sir Test',
  workspace_id: 1,
  workspace_name: 'Test',
  role: 'owner',
  mode: 'assisted',
  compliance_ack_at: '2026-08-08T00:00:00+00:00',
  paused_at: null,
  environment: 'test',
  demo_mode: false,
}

describe('dashboard', () => {
  it('renders truthful empty operational state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      counts: { reviews: 0, due: 0, replies: 0, prospects: 0 },
      queue: [], campaigns: [], reminders: [], events: [],
      safety: { local_only: true, assisted_send_only: true, compliance_acknowledged: true, paused: false, demo_mode: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<MemoryRouter><Dashboard member={member} /></MemoryRouter>)

    expect(await screen.findByText('Your queue is clear')).toBeVisible()
    expect(screen.getByText(/does not send messages for you/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /Review 0 drafts/i })).toBeVisible()
  })
})
