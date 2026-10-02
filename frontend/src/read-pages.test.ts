import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { coreReadRows } from './test/page-records'

const rows: Record<string, Record<string, unknown>> = coreReadRows
const page = (items: unknown[]) => ({ items, total: items.length, limit: 50, offset: 0 })
afterEach(() => vi.unstubAllGlobals())

describe('core paged read records', () => {
  it.each(Object.entries(rows))('preserves a complete %s row without rewriting it', async (path, row) => {
    const body = page([{ ...row, future_field: 'Preserved additive field' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    expect(await api(`/${path}?limit=50&offset=0`)).toEqual(body)
  })
  for (const [path, row] of Object.entries(rows)) {
    for (const field of Object.keys(row).filter(field => !['total', 'reviewed'].includes(field))) {
      it(`rejects an object in ${path}.${field}, without retaining private response details or retrying`, async () => {
        const fetch = vi.fn().mockResolvedValue(Response.json(page([{ ...row, [field]: { private: 'never retain this diagnostic body' } }])))
        vi.stubGlobal('fetch', fetch)
        const result = api(`/${path}?limit=50&offset=0`)
        await expect(result).rejects.toBeInstanceOf(ApiError)
        await expect(result).rejects.toMatchObject({ code: 'response_unverified', details: undefined })
        expect(fetch).toHaveBeenCalledTimes(1)
      })
      it(`rejects missing ${path}.${field}`, async () => {
        const incomplete = { ...row }
        delete incomplete[field]
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([incomplete]))))
        await expect(api(`/${path}`)).rejects.toMatchObject({ code: 'response_unverified' })
      })
    }
    it.each([null, [], false, 'not a record', { ...row, id: 0 }, { ...row, id: '1' }, { ...row, id: Number.MAX_SAFE_INTEGER + 1 }])(`rejects malformed ${path} row %j`, async bad => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([bad]))))
      await expect(api(`/${path}`)).rejects.toMatchObject({ code: 'response_unverified' })
    })
    it(`rejects duplicate ${path} identities rather than rendering misleading rows`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([row, row]))))
      await expect(api(`/${path}`)).rejects.toMatchObject({ code: 'response_unverified' })
    })
    it(`accepts empty ${path} results`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([]))))
      expect(await api(`/${path}`)).toEqual(page([]))
    })
  }
  it('preserves legacy date text, unknown status labels and detached template history', async () => {
    const historic = { ...rows.drafts, template_id: null, template_name: null, updated_at: 'legacy unknown instant', state: 'legacy-status' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page([historic]))))
    expect(await api('/drafts')).toEqual(page([historic]))
  })
  it('does not falsely certify other endpoints or apply a paged contract to writes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Response.json({ status: 'open' })))
    expect(await api('/reminders/1', { method: 'PATCH', body: JSON.stringify({ status: 'open' }) })).toEqual({ status: 'open' })
    expect(await api('/other-read')).toEqual({ status: 'open' })
  })
})
