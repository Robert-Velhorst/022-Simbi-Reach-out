import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderWithRouter } from '../test/router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import type { Draft, Member } from '../types'

const member: Member = { user_id: 1, email: 'qa@example.test', display_name: 'QA', workspace_id: 1, workspace_name: 'QA workspace', role: 'viewer', mode: 'assisted', compliance_ack_at: '2026-09-05', paused_at: null, environment: 'test', demo_mode: false }
const draft: Draft = { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'QA person', organization: 'QA', source_url: 'https://simbi.com/qa', consent_status: 'consented', campaign_name: 'QA campaign', template_name: 'QA template', subject: 'QA subject', body: 'QA message', state: 'needs_review', quality_score: 100, content_hash: 'qa-content', edit_version: 'b'.repeat(64), safety_flags: [], updated_at: '2026-09-05T12:00:00Z' }
const rows = {
  prospects: [{ id: 1, name: 'QA person', organization: 'QA', provider: 'simbi', source_url: 'https://simbi.com/qa', contact_handle: '', notes: '', consent_status: 'consented', created_at: '2026-09-05' }],
  campaigns: [{ id: 1, name: 'QA campaign', description: '', purpose: 'QA purpose', lawful_basis: 'QA context', status: 'active', daily_limit: 10, cooldown_minutes: 1440 }],
  templates: [{ id: 1, name: 'QA template', provider: 'simbi', subject: '', body: 'QA template body', version: 1 }],
  replies: [{ id: 1, draft_id: 1, prospect_name: 'QA person', campaign_name: 'QA campaign', body: 'QA reply', received_at: '2026-09-05T12:00:00Z', direction: 'inbound' }],
  reminders: [{ id: 1, title: 'QA reminder', due_at: '2026-09-05T12:00:00Z', status: 'open', prospect_name: 'QA person', campaign_name: 'QA campaign' }],
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

function show(path: string, role: Member['role'], empty = false, state = 'needs_review') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if ((options.method ?? 'GET') !== 'GET') throw new Error(`Unexpected write: ${url}`)
    const resource = new URL(url, 'http://localhost').pathname.replace('/api/', '')
    if (resource === 'handoffs') return Response.json({ items: [{ id: 1, draft_id: 1, provider_url: 'https://simbi.com/qa', subject: draft.subject, body: draft.body, status: 'prepared', instruction: 'Manual action only', can_open_provider: false }] })
    const items = empty ? [] : resource === 'drafts' ? [{ ...draft, state }] : rows[resource as keyof typeof rows]
    if (!items) throw new Error(`Unexpected read: ${url}`)
    return Response.json({ items, total: items.length, limit: 50, offset: 0 })
  }))
  return renderWithRouter(<AppShell member={{ ...member, role }} onMemberChange={() => {}} onSignedOut={() => {}} />, [path])
}

const pages = [
  ['/prospects', 'QA person', 'No prospects', ['Add prospect', 'Import CSV', 'Add the first prospect', 'Stop contact']],
  ['/campaigns', 'QA campaign', 'No campaigns', ['New campaign', 'Create campaign', 'Activate', 'Pause', 'Archive']],
  ['/templates', 'QA template', 'No templates', ['New template']],
  ['/replies', 'QA reply', 'No replies recorded', ['Record reply']],
  ['/reminders', 'QA reminder', 'No open reminders', ['New reminder', 'Done']],
] as const

describe('viewer routes reflect existing server permissions', () => {
  for (const empty of [false, true]) {
    it.each(pages)(`keeps %s readable without write controls (empty=${empty})`, async (path, record, emptyTitle, controls) => {
      show(path, 'viewer', empty)
      await screen.findByText(empty ? emptyTitle : record, { exact: true })
      for (const name of controls) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      expect(screen.getByText(/Your viewer role has read-only access/)).toBeVisible()
      if (path === '/prospects') expect(screen.getByPlaceholderText('Search name, organization or notes')).toBeEnabled()
    })
  }

  it.each(['needs_review', 'approved', 'handoff_created', 'ambiguous'])('keeps %s drafts read-only, including handoff history', async (state) => {
    show('/review', 'viewer', false, state)
    await screen.findByLabelText('Message')
    expect(screen.getByLabelText('Message')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Subject')).toHaveAttribute('readonly')
    for (const name of ['Prepare draft', 'Save and return to review', 'Approve for handoff', 'Decline', 'Copy and open provider', 'Resolve latest handoff']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    if (['handoff_created', 'ambiguous'].includes(state)) {
      fireEvent.click(screen.getByRole('button', { name: 'View latest handoff' }))
      await screen.findByRole('dialog')
      expect(screen.getByLabelText('Approved message')).toHaveValue('QA subject\n\nQA message')
      for (const name of ['Not sent', 'Sent manually', 'Unsure — needs verification', 'Copy message', 'Open provider']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
    }
  })

  it('does not offer draft creation to a viewer with an empty queue', async () => {
    show('/review', 'viewer', true)
    await screen.findByText('No drafts to review')
    expect(screen.queryByRole('button', { name: 'Prepare draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare first draft' })).not.toBeInTheDocument()
  })
})

describe('write-enabled roles retain their existing actions', () => {
  for (const role of ['owner', 'admin', 'editor'] as const) {
    it.each(pages)(`${role} can open the primary action on %s`, async (path, record, _emptyTitle, controls) => {
      show(path, role)
      await screen.findByText(record, { exact: true })
      fireEvent.click(screen.getByRole('button', { name: controls[0] }))
      expect(await screen.findByRole('dialog')).toBeVisible()
    })
  }
})
