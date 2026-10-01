import { afterEach, expect, it, vi } from 'vitest'
import { post } from './api'

const key = 'fictional-reminder-reference-0001'
const body = { prospect_id: 2, title: 'Fictional follow-up', due_at: '2027-01-02T12:34:00Z' }
const result = { id: 9, draft_id: null, status: 'open', ...body, creation_key: key, replayed: false }
afterEach(() => { vi.unstubAllGlobals() })

it.each([{ creation_key: undefined }, { creation_key: 'other-reference' }, { replayed: undefined }, { replayed: 'true' }])('refuses a mismatched or incomplete keyed reminder receipt %j', async (changed) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...result, ...changed })))
  await expect(post('/reminders', body, { 'Idempotency-Key': key })).rejects.toMatchObject({ code: 'response_unverified' })
})

it.each([false, true])('accepts the exact original or replayed receipt (%s) without another request', async (replayed) => {
  const fetchMock = vi.fn(async () => Response.json({ ...result, replayed }))
  vi.stubGlobal('fetch', fetchMock)
  await expect(post('/reminders', body, { 'Idempotency-Key': key })).resolves.toMatchObject({ id: 9, creation_key: key, replayed })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
