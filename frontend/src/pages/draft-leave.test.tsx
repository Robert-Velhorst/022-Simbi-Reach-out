import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from '../components/AppShell'
import type { Draft, Member } from '../types'

const member: Member = { user_id: 1, email: 'owner@example.test', display_name: 'Owner', workspace_id: 1, workspace_name: 'Personal fixture', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-01', paused_at: null, environment: 'test', demo_mode: false }
const original: Draft = { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'First fictional person', organization: '', source_url: 'https://simbi.com/fictional', consent_status: 'consented', campaign_name: 'Fictional campaign', template_name: 'Fictional template', subject: 'First subject', body: 'Original saved fictional message.', state: 'needs_review', quality_score: 100, content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64), safety_flags: [], updated_at: '2026-10-01' }
const second = { ...original, id: 2, prospect_name: 'Second fictional person', subject: 'Second subject' }
const unsaved = 'Private fictional edits that must not be silently lost.'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function show(write?: (options: RequestInit) => Promise<Response>) {
  const writes: string[] = []
  const reads: string[] = []
  const signedOut = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if ((options.method ?? 'GET') !== 'GET') {
      writes.push(url)
      return write ? write(options) : Response.json({ ok: true })
    }
    reads.push(url)
    if (url.startsWith('/api/drafts?')) {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'))
      return Response.json({ items: offset ? [{ ...second, id: 3 }] : [original, second], offset, limit: 50, total: 51 })
    }
    return Response.json({ items: [], total: 0, limit: 50, offset: 0 })
  }))
  const router = createMemoryRouter([{ path: '*', element: <AppShell member={member} onMemberChange={() => {}} onSignedOut={signedOut} /> }], { initialEntries: ['/help', '/review'] })
  render(<RouterProvider router={router} />)
  return { router, writes, reads, signedOut }
}

async function edit() { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: unsaved } }) }
const warning = () => screen.findByRole('dialog', { name: 'Leave this draft?' })
async function keep() { fireEvent.click(within(await warning()).getByRole('button', { name: 'Keep editing' })) }
async function discard() { fireEvent.click(within(await warning()).getByRole('button', { name: 'Discard local edits and continue' })) }

describe('explicit-save draft leave protection', () => {
  it('keeps edits on selecting the same draft and asks before selecting another', async () => {
    const { writes } = show(); await edit()
    fireEvent.click(screen.getByRole('button', { name: /First fictional person/ }))
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Second fictional person/ }))
    await keep()
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    fireEvent.click(screen.getByRole('button', { name: /Second fictional person/ }))
    await discard()
    expect(screen.getByLabelText('Subject')).toHaveValue(second.subject)
    expect(writes).toEqual([])
  })

  it('does not fetch another page or clear review checks until explicit discard', async () => {
    const { reads, writes } = show(); await edit()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await keep()
    expect(reads.some((url) => url.includes('offset=50'))).toBe(false)
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await discard()
    await waitFor(() => expect(reads.some((url) => url.includes('offset=50'))).toBe(true))
    expect(writes).toEqual([])
  })

  it.each(['link', 'history', 'drawer'])('blocks %s navigation and cancellation preserves the draft', async (mode) => {
    const { router, writes } = show(); await edit()
    if (mode === 'history') await act(async () => { await router.navigate(-1) })
    else if (mode === 'drawer') {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Primary navigation' })).getByRole('link', { name: 'Help' }))
    } else fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    await keep()
    expect(router.state.location.pathname).toBe('/review')
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    await discard()
    await waitFor(() => expect(router.state.location.pathname).toBe('/help'))
    expect(writes).toEqual([])
  })

  it('does not log out until an explicit discard; cancellation does not send a request', async () => {
    const { writes, signedOut } = show(); await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await keep()
    expect(writes).toEqual([])
    expect(signedOut).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await discard()
    await waitFor(() => expect(signedOut).toHaveBeenCalledOnce())
    expect(writes).toEqual(['/api/auth/logout'])
  })

  it('asks before opening preparation, which may replace the selected draft', async () => {
    const { writes } = show(); await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare draft' }))
    await keep()
    expect(screen.queryByRole('dialog', { name: 'Prepare a deterministic draft' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(writes).toEqual([])
  })

  it('registers a browser unload warning only while edits are unresolved and cleans up on unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { router } = show(); await screen.findByLabelText('Message')
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0)
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await edit()
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
    const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: original.body } })
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
    const reverted = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reverted)
    expect(reverted.defaultPrevented).toBe(false)
    await act(async () => { await router.navigate('/help') })
    const left = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(left)
    expect(left.defaultPrevented).toBe(false)
    add.mockRestore(); remove.mockRestore()
  })

  it('will not leave during a pending save, or auto-leave after a successful response', async () => {
    let finish!: (value: Response) => void
    const { router, writes } = show(() => new Promise<Response>((resolve) => { finish = resolve }))
    await edit(); fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }))
    fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    const dialog = await warning()
    expect(within(dialog).getByRole('button', { name: 'Discard local edits and continue' })).toBeDisabled()
    await act(async () => { finish(Response.json({ ...original, body: unsaved, content_hash: 'c'.repeat(64), edit_version: 'd'.repeat(64) })) })
    expect(router.state.location.pathname).toBe('/review')
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    // A blocked destination must not be silently replayed after a save settles.
    await keep()
    fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/help'))
    expect(writes).toEqual(['/api/drafts/1'])
  })

  it('keeps an uncertain save protected even if local text is reverted to the viewed version', async () => {
    show(async () => { throw new Error('Lost save response') }); await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save and return to review' }))
    await screen.findByText('The save result could not be verified. Keep your edits and check the saved version.')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: original.body } })
    fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    await keep()
    expect(screen.getByRole('button', { name: 'Check saved version' })).toBeEnabled()
  })
})
