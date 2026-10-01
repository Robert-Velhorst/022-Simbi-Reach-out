import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, post } from './api'

afterEach(() => vi.unstubAllGlobals())

const campaign = { name: 'Fictional campaign', description: '', purpose: 'A specific fictional exchange', lawful_basis: 'An authorized published request', daily_limit: 10, cooldown_minutes: 1440 }
const template = { name: 'Fictional template', provider: 'simbi', subject: '', body: 'Hello {name}, this is a fictional message.' }
const prospect = { name: 'Fictional person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/fictional', contact_handle: '', notes: '', consent_status: 'contextual' }
const draftInput = { campaign_id: 1, prospect_id: 2, template_id: 3 }
const draftResult = { ...draftInput, id: 4, state: 'needs_review', quality_score: 80, safety_flags: [] }
const replyInput = { draft_id: 4, body: 'Fictional reply' }
const replyResult = { ...replyInput, id: 5, state: 'replied', received_at: '2026-10-01T12:00:00+00:00' }
const reminderInput = { draft_id: 4, title: 'Fictional reminder', due_at: '2026-10-02T12:00:00Z' }
const reminderResult = { ...reminderInput, prospect_id: null, id: 6, status: 'open' }

describe('core creation response contracts', () => {
  it.each([
    ['/campaigns', campaign, { ...campaign, id: 1, status: 'draft' }],
    ['/templates', template, { ...template, id: 1, version: 1 }],
    ['/prospects', prospect, { ...prospect, id: 1, created_at: '2026-10-01T12:00:00Z' }],
    ['/drafts', draftInput, draftResult],
    ['/replies', replyInput, replyResult],
    ['/reminders', reminderInput, reminderResult],
    ['/prospects/import', { csv_text: 'fictional', commit: false }, { valid: 1, errors: [], inserted: 0, duplicates: 0, committed: false }],
    ['/prospects/import', { csv_text: 'fictional', commit: true }, { valid: 2, errors: [], inserted: 1, duplicates: 1, committed: true }],
  ])('accepts the actual successful %s backend contract', async (path, submitted, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)))
    await expect(post(String(path), submitted)).resolves.toEqual(result)
  })
  it('accepts inspected provider/source normalization and a stronger existing restriction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...prospect, id: 1, consent_status: 'opted_out', created_at: '2026-10-01T12:00:00Z' })))
    await expect(post('/prospects', { ...prospect, provider: ' SIMBI ', name: ` ${prospect.name} `, source_url: 'https://SIMBI.com:443/fictional#reference' })).resolves.toMatchObject({ consent_status: 'opted_out' })
  })
  it.each([
    ['/campaigns', campaign], ['/prospects', prospect], ['/templates', template],
    ['/drafts', { campaign_id: 1, prospect_id: 1, template_id: 1 }],
    ['/replies', { draft_id: 1, body: 'A fictional reply' }],
    ['/reminders', { draft_id: 1, title: 'Fictional reminder', due_at: '2026-10-02T12:00:00Z' }],
  ])('does not accept an empty object as a confirmed %s creation', async (path, submitted) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetchMock)
    await expect(post(String(path), submitted)).rejects.toMatchObject({ code: 'response_unverified', message: expect.stringMatching(/may already have changed local records/i) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['/templates', template, { ...template, id: 1, version: 1, body: 'A different saved message' }],
    ['/campaigns', campaign, { ...campaign, id: 1, status: 'draft', daily_limit: 50 }],
    ['/prospects', prospect, { ...prospect, id: 1, created_at: '2026-10-01T12:00:00Z', source_url: 'https://simbi.com/another' }],
    ['/drafts', { campaign_id: 1 }, { id: 1, state: 'sent', quality_score: 100, safety_flags: [] }],
    ['/replies', { draft_id: 1 }, { id: 1, state: 'sent' }],
    ['/reminders', { draft_id: 1 }, { id: 1, status: 'done' }],
  ])('rejects a readable but inconsistent %s confirmation', async (path, submitted, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)))
    await expect(post(String(path), submitted)).rejects.toMatchObject({ code: 'response_unverified' })
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid created record identity %s', async (id) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...template, id, version: 1 })))
    await expect(post('/templates', template)).rejects.toMatchObject({ code: 'response_unverified' })
  })

  it('does not turn malformed CSV preview into a commit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ valid: 1, errors: [], committed: true, inserted: 1, duplicates: 0 })))
    await expect(post('/prospects/import', { csv_text: 'fictional', commit: false })).rejects.toMatchObject({ code: 'response_unverified' })
  })
  it('rejects inconsistent CSV commit counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ valid: 2, errors: [], committed: true, inserted: 1, duplicates: 0 })))
    await expect(post('/prospects/import', { csv_text: 'fictional', commit: true })).rejects.toMatchObject({ code: 'response_unverified' })
  })
  it('does not impose core creation contracts on existing domain receipts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ plan_id: 'fictional' })))
    await expect(api('/privacy/receipts/fictional')).resolves.toEqual({ plan_id: 'fictional' })
  })

  it.each([
    ['/drafts', draftInput, { ...draftResult, campaign_id: 99 }],
    ['/drafts', draftInput, { ...draftResult, prospect_id: 99 }],
    ['/drafts', draftInput, { ...draftResult, template_id: null }],
    ['/replies', replyInput, { ...replyResult, draft_id: 99 }],
    ['/replies', replyInput, { ...replyResult, body: 'A different reply' }],
    ['/replies', replyInput, { ...replyResult, received_at: 'not-a-date' }],
    ['/replies', { ...replyInput, received_at: '2026-10-01T12:00:00.123456Z' }, { ...replyResult, received_at: '2026-10-01T12:00:00.123457Z' }],
    ['/reminders', reminderInput, { ...reminderResult, draft_id: 99 }],
    ['/reminders', reminderInput, { ...reminderResult, prospect_id: 99 }],
    ['/reminders', reminderInput, { ...reminderResult, title: 'A different reminder' }],
    ['/reminders', reminderInput, { ...reminderResult, due_at: '2026-10-02T12:01:00Z' }],
    ['/reminders', { ...reminderInput, due_at: '2026-02-30T12:00:00Z' }, { ...reminderResult, due_at: '2026-02-30T12:00:00Z' }],
  ])('rejects a wrong conversation/content/time confirmation for %s without retry', async (path, submitted, result) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch', fetchMock)
    await expect(post(String(path), submitted)).rejects.toMatchObject({ code: 'response_unverified' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['/replies', { ...replyInput, body: '  Fictional reply  ', received_at: '2026-10-01T14:00:00.123456+02:00' }, { ...replyResult, received_at: '2026-10-01T12:00:00.123456+00:00' }],
    ['/reminders', { ...reminderInput, title: '  Fictional reminder  ', due_at: '2026-10-02T14:00:00+02:00' }, { ...reminderResult, due_at: '2026-10-02T12:00:00.000000+00:00' }],
    ['/reminders', { prospect_id: 2, title: reminderInput.title, due_at: reminderInput.due_at }, { ...reminderResult, draft_id: null, prospect_id: 2 }],
    ['/reminders', { ...reminderInput, prospect_id: 2 }, { ...reminderResult, prospect_id: 2 }],
  ])('accepts normalized content, equal UTC instants and explicit targets for %s', async (path, submitted, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)))
    await expect(post(String(path), submitted)).resolves.toEqual(result)
  })
})
