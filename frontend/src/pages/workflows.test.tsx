import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewQueue from './ReviewQueue'
import SettingsPage from './Settings'
import { ProspectsPage, TemplatesPage } from './Resources'
import { RepliesPage, RemindersPage, ReportsPage, AuditPage } from './Operations'
import { SetupScreen } from '../components/Auth'
import type { Draft, Member } from '../types'

const member: Member = { user_id: 1, email: 'owner@example.test', display_name: 'Owner', workspace_id: 1, workspace_name: 'Test', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-09-05', paused_at: null, environment: 'test', demo_mode: false }
const draft = (id: number, state = 'needs_review'): Draft => ({ id, campaign_id: 1, prospect_id: id, template_id: 1, prospect_name: `Person ${id}`, organization: '', source_url: 'https://simbi.com/person', consent_status: 'consented', campaign_name: 'Campaign', template_name: 'Template', subject: `Subject ${id}`, body: `Body ${id}`, state, quality_score: 100, content_hash: 'fixture-content-hash', safety_flags: [], updated_at: '2026-09-05T12:00:00Z' })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const page = (items: unknown[], offset = 0, total = items.length) => ({ items, offset, total, limit: 50 })
const handoff = { id: 10, draft_id: 1, subject: 'Subject 1', body: 'Body 1', status: 'prepared', provider_url: 'https://simbi.com/person', instruction: 'Send manually', can_open_provider: true }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('review workflow recovery', () => {
  it('requires saving dirty editor text and repeating the checks before approval', async () => {
    let saved = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'PATCH') { saved = true; return response({}) }
      return response(page(url.includes('/drafts') ? [{ ...draft(1), content_hash: saved ? 'saved-hash' : 'original-hash', body: saved ? 'Changed body' : 'Body 1' }] : []))
    }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await screen.findByLabelText('Message')
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Changed body' } })
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }))
    await waitFor(() => expect(saved).toBe(true))
    await waitFor(() => expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true))
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeDisabled()
  })

  it('binds approval to the displayed saved hash and surfaces a stale-draft rejection', async () => {
    let submitted: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/review')) { submitted = JSON.parse(String(options.body)); return response({ error: { code: 'draft_changed', message: 'Draft changed. Reload and review again.' } }, 409) }
      return response(page(url.includes('/drafts') ? [{ ...draft(1), content_hash: 'original-hash' }] : []))
    }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await screen.findByLabelText('Message')
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    fireEvent.click(screen.getByRole('button', { name: 'Approve for handoff' }))
    expect(await screen.findByText('Draft changed. Reload and review again.')).toBeVisible()
    expect(submitted?.expected_content_hash).toBe('original-hash')
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true)
  })

  it('keeps a revoked handoff outcome-only with no assisted provider controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/handoffs?') ? { items: [{ ...handoff, can_open_provider: false }] } : page(url.includes('/drafts') ? [draft(1, 'handoff_created')] : []))))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve latest handoff' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Open provider' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Open provider' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/permissions changed/i)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Sent manually' })).toBeEnabled()
  })

  it.each(['Copy message', 'Open provider'])('revalidates access before %s when a displayed handoff was revoked', async (action) => {
    const copied: string[] = []
    vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => { copied.push(text) } } })
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/handoffs?')) { reads++; return response({ items: [{ ...handoff, can_open_provider: false }] }) }
      return response(url.endsWith('/handoff') ? handoff : page(url.includes('/drafts') ? [draft(1, 'approved')] : []))
    }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy and open provider' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText(action))
    await waitFor(() => expect(reads).toBe(1))
    expect(await within(dialog).findByText(/permissions changed/i)).toBeVisible()
    expect(copied).toEqual([])
  })

  it('replaces edited fields when the user selects another draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(page(url.includes('/drafts') ? [draft(1), draft(2)] : []))))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Unsaved first message' } })
    fireEvent.click(screen.getByRole('button', { name: /Person 2/ }))
    expect(screen.getByLabelText('Subject')).toHaveValue('Subject 2')
    expect(screen.getByLabelText('Message')).toHaveValue('Body 2')
  })

  it('reopens a pending handoff after returning to the queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/handoffs?') ? { items: [handoff] } : page(url.includes('/drafts') ? [draft(1, 'handoff_created')] : []))))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Resolve latest handoff/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('The app has not sent anything')
    expect(screen.getByLabelText('Approved message')).toHaveValue('Subject 1\n\nBody 1')
  })

  it('reuses the handoff request identity after a lost response', async () => {
    const keys: (string | null)[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/handoff')) {
        keys.push(new Headers(options.headers).get('Idempotency-Key'))
        if (keys.length === 1) throw new Error('Connection lost')
        return response(handoff)
      }
      return response(page(url.includes('/drafts') ? [draft(1, 'approved')] : []))
    }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Copy and open provider/ }))
    await screen.findByText(/local service is unavailable/)
    fireEvent.click(screen.getByRole('button', { name: /Copy and open provider/ }))
    await screen.findByRole('dialog')
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it('shows clipboard failure inside the handoff dialog', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('Denied') } } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/handoffs?') ? { items: [handoff] } : url.endsWith('/handoff') ? handoff : page(url.includes('/drafts') ? [draft(1, 'approved')] : []))))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Copy and open provider/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy message' }))
    expect(await within(dialog).findByText(/could not copy/i)).toBeVisible()
  })
})

describe('resource loading and settings', () => {
  it('records a reason-bearing stop-contact decision and disables repeat suppression', async () => {
    let submitted: unknown
    let stopped = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/suppressions')) { submitted = JSON.parse(String(options.body)); stopped = true; return response({ id: 1 }) }
      return response(page([{ id: 7, name: 'Stop person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/person', contact_handle: '', notes: '', consent_status: stopped ? 'opted_out' : 'consented', created_at: '2026-09-05' }]))
    }))
    render(<ProspectsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop contact' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Person asked not to be contacted again' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm stop contact' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(submitted).toEqual({ prospect_id: 7, reason: 'Person asked not to be contacted again' })
    expect(screen.getByRole('button', { name: 'Stop contact' })).toBeDisabled()
    expect(screen.getByText('opted out')).toBeVisible()
  })

  it.each([['Replies', RepliesPage], ['Reminders', RemindersPage], ['Reports', ReportsPage], ['Audit', AuditPage]] as const)('shows operational load failures for %s', async (_name, Component) => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { code: 'unavailable', message: 'Service unavailable for this page' } }, 503)))
    render(<Component />)
    expect((await screen.findAllByText('Service unavailable for this page'))[0]).toBeVisible()
  })

  it('loads the configured provider URL instead of keeping the initial fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ workspace: { name: 'Test', compliance_ack_at: null, paused_at: null, retention_days: 365 }, providers: [{ provider: 'simbi', base_url: 'https://simbi.com/messages', mode: 'assisted', verified_at: null }], members: [], environment: 'test', demo_mode: false })))
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('HTTPS base URL')).toHaveValue('https://simbi.com/messages'))
  })

  it('requires and submits the operator bootstrap token when production setup needs it', async () => {
    let submitted: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => { submitted = JSON.parse(String(options.body)); return response({ status: 'created', csrf_token: 'test' }) }))
    render(<SetupScreen setupTokenRequired onComplete={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Setup token/), { target: { value: 'operator-bootstrap-token' } })
    fireEvent.submit(screen.getByLabelText(/Setup token/).closest('form')!)
    await waitFor(() => expect(submitted?.setup_token).toBe('operator-bootstrap-token'))
  })

  it('reaches the next bounded prospect page', async () => {
    const offsets: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const offset = new URL(url, 'http://localhost').searchParams.get('offset') ?? '0'
      offsets.push(offset)
      return response(page([{ id: Number(offset) + 1, name: offset === '0' ? 'First person' : 'Later person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/person', contact_handle: '', notes: '', consent_status: 'consented', created_at: '2026-09-05' }], Number(offset), 51))
    }))
    render(<ProspectsPage />)
    await screen.findByText('First person')
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('Later person')).toBeVisible()
    expect(screen.queryByText('First person')).not.toBeInTheDocument()
    expect(offsets).toEqual(['0', '50'])
  })

  it('shows list request failures instead of silently showing an empty collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: 'Templates unavailable', code: 'unavailable' } }, 503)))
    render(<TemplatesPage />)
    expect(await screen.findByText('Templates unavailable')).toBeVisible()
  })

  it('resets the captured member form after asynchronous creation succeeds', async () => {
    const settings = { workspace: { name: 'Test', compliance_ack_at: null, paused_at: null, retention_days: 365 }, providers: [{ provider: 'simbi', base_url: 'https://simbi.com/', mode: 'assisted', verified_at: null }], members: [], environment: 'test', demo_mode: false }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/team') ? { id: 2 } : settings)))
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New member' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'long-test-password' } })
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    expect(await screen.findByText('Local team member added.')).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''))
  })

  it('changes the local password then offers explicit sign-in after session revocation', async () => {
    let passwordBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/auth/password')) { passwordBody = JSON.parse(String(options.body)); return response({ changed: true, reauthenticate: true }) }
      return response({ workspace: { name: 'Test', compliance_ack_at: null, paused_at: null, retention_days: 365 }, providers: [], members: [], environment: 'test', demo_mode: false })
    }))
    render(<SettingsPage member={member} onMemberChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-test-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-test-password' } })
    fireEvent.submit(screen.getByLabelText('Current password').closest('form')!)
    expect(await screen.findByText(/All your sessions have been signed out/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/')
    expect(passwordBody).toEqual({ current_password: 'old-test-password', new_password: 'new-test-password' })
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument()
  })
})
