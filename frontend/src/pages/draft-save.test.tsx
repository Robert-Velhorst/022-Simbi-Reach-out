import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReviewQueue from './ReviewQueue'
import type { Draft, Member } from '../types'

const member: Member = { user_id: 1, email: 'owner@example.test', display_name: 'Owner', workspace_id: 1, workspace_name: 'Personal fixture', role: 'owner', mode: 'assisted', compliance_ack_at: '2026-10-01', paused_at: null, environment: 'test', demo_mode: false }
const original: Draft = { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Fictional Person', organization: '', source_url: 'https://simbi.com/fictional', consent_status: 'consented', campaign_name: 'Fictional campaign', template_name: 'Fictional template', subject: 'Original subject', body: 'Original saved message for a fictional person.', state: 'needs_review', quality_score: 100, content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64), safety_flags: [], updated_at: '2026-10-01T12:00:00Z' }
const unsaved = 'My unsaved personalized message stays in this editor.'
const newer = { ...original, subject: 'Saved elsewhere', body: 'A newer saved message from another fictional tab.', content_hash: 'c'.repeat(64), edit_version: 'd'.repeat(64) }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const page = (items: unknown[]) => ({ items, total: items.length, offset: 0, limit: 50 })
const conflict = () => response({ error: { code: 'draft_save_conflict', message: 'Changed elsewhere' } }, 409)
const saveButton = () => screen.getByRole('button', { name: 'Save and return to review' })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function stubService(write: (body: Record<string, unknown>) => Promise<Response> | Response, read: () => unknown = () => newer) {
  const writes: Record<string, unknown>[] = []
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === 'PATCH') { const body = JSON.parse(String(options.body)); writes.push(body); return write(body) }
    if (url === '/api/drafts/1') return response(read())
    return response(page(url.startsWith('/api/drafts?') ? [original] : []))
  })
  vi.stubGlobal('fetch', fetcher)
  return { writes, fetcher }
}

async function editAndSave() {
  fireEvent.change(await screen.findByLabelText('Message'), { target: { value: unsaved } })
  fireEvent.click(saveButton())
}

describe('version-bound personal draft saving', () => {
  it('sends the viewed edit version and accepts only an exact saved message', async () => {
    const { writes } = stubService(() => response({ ...newer, subject: original.subject, body: unsaved }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await screen.findByLabelText('Message')
    expect(saveButton()).toBeDisabled()
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    await editAndSave()
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(writes).toEqual([{ subject: original.subject, body: unsaved, expected_edit_version: original.edit_version }])
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true)
  })

  it('preserves conflicting edits, locks writes and cancel returns focus without mutation', async () => {
    const { writes } = stubService(conflict)
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    await screen.findByText('The saved draft changed. Your unsaved edits remain here. Compare the saved version before saving.')
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(saveButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: original.body } })
    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
    const trigger = screen.getByRole('button', { name: 'Check saved version' })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Compare saved draft' })
    expect(within(dialog).getByLabelText('Saved message')).toHaveValue(newer.body)
    expect(within(dialog).getByLabelText('Unsaved message')).toHaveValue(original.body)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(writes).toHaveLength(1)
  })

  it('requires a separate save after choosing to keep local edits against the compared version', async () => {
    const { writes } = stubService((body) => writes.length === 1 ? conflict() : response({ ...newer, subject: body.subject, body: body.body, edit_version: 'e'.repeat(64), content_hash: 'f'.repeat(64) }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved version' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my edits for a new review' }))
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(writes).toHaveLength(1)
    expect(saveButton()).toBeEnabled()
    expect(document.activeElement).toHaveClass('draft-editor')
    fireEvent.click(saveButton())
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1].expected_edit_version).toBe(newer.edit_version)
    expect(writes[1].body).toBe(unsaved)
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Approve for handoff' })).toBeDisabled()
  })

  it('discards local edits only on the explicit saved-version choice, with no write', async () => {
    const { writes } = stubService(conflict)
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved version' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard my edits and use saved version' }))
    expect(screen.getByLabelText('Subject')).toHaveValue(newer.subject)
    expect(screen.getByLabelText('Message')).toHaveValue(newer.body)
    expect(saveButton()).toBeDisabled()
    expect(writes).toHaveLength(1)
  })

  it('recovers a lost save response by explicitly accepting the identical current saved text', async () => {
    const { writes } = stubService(() => { throw new Error('Connection lost after commit') }, () => ({ ...newer, subject: original.subject, body: unsaved }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    await screen.findByText('The save result could not be verified. Keep your edits and check the saved version.')
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    fireEvent.click(screen.getByRole('button', { name: 'Check saved version' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Keep my edits for a new review' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use verified saved version' }))
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(saveButton()).toBeDisabled()
    expect(writes).toHaveLength(1)
    expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true)
  })

  it.each([{ ...newer, id: 2, body: unsaved }, { ...newer, edit_version: 'invalid', body: unsaved }, { ...newer, body: 'Wrong returned message' }, { ...newer, subject: original.subject, body: unsaved, edit_version: original.edit_version }])('rejects mismatched save responses without clearing the editor', async (badResponse) => {
    stubService(() => response(badResponse))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    await screen.findByText('The save result could not be verified. Keep your edits and check the saved version.')
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(saveButton()).toBeDisabled()
  })

  it('refuses a mismatched saved-version read without discarding edits or writing again', async () => {
    const { writes } = stubService(conflict, () => ({ ...newer, id: 2 }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved version' }))
    await screen.findByText('The saved version could not be verified. Your unsaved edits remain here.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
    expect(writes).toHaveLength(1)
  })

  it('allows validation repair without forcing an uncertain-write comparison', async () => {
    stubService(() => response({ error: { code: 'validation_failed', message: 'Message needs more detail' } }, 422))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    await screen.findByText('Message needs more detail')
    expect(saveButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Check saved version' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue(unsaved)
  })

  it('does not permit retaining edits against a locked saved draft', async () => {
    stubService(conflict, () => ({ ...newer, state: 'sent' }))
    render(<ReviewQueue member={member} onMemberChange={() => {}} />)
    await editAndSave()
    fireEvent.click(await screen.findByRole('button', { name: 'Check saved version' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Keep my edits for a new review' })).not.toBeInTheDocument()
  })
})
