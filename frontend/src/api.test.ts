import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, post } from './api'

describe('API client', () => {
  beforeEach(() => {
    document.cookie = 'simbi_csrf=test-token; path=/'
  })

  it('adds the CSRF header to writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await post('/settings/pause', { paused: true })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect((request.headers as Headers).get('X-CSRF-Token')).toBe('test-token')
    expect(request.credentials).toBe('include')
  })

  it('returns the backend error envelope as ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'workspace_paused', message: 'Outreach is paused' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    await expect(api('/drafts/1/handoff', { method: 'POST' })).rejects.toEqual(
      expect.objectContaining({ code: 'workspace_paused', message: 'Outreach is paused' }),
    )
  })
})
