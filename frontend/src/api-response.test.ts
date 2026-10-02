import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, post } from './api'
import { operationalReads } from './test/operational-reads'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete API response boundary', () => {
  it.each(['', '<html>Proxy response</html>', '{"status":'])('rejects an unreadable successful body rather than inventing an empty result: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(api('/overview')).rejects.toMatchObject({ code: 'response_unverified' })
  })

  it.each(['null', 'true', '42', '"proxy response"'])('rejects successful JSON outside the API object/array contract: %s', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(api('/overview')).rejects.toMatchObject({ code: 'response_unverified' })
  })

  it('keeps the deadline running through a stalled body and aborts its owned signal', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      signal = options.signal as AbortSignal
      return { ok: true, status: 200, json: () => new Promise(() => {}) }
    }))
    let outcome: unknown = 'pending'
    void api('/overview').then((value) => { outcome = value }, (cause) => { outcome = cause })
    await vi.advanceTimersByTimeAsync(20_001)
    expect(outcome).toMatchObject({ code: 'request_timeout' })
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an interrupted write as unknown, performs no automatic retry and preserves its code', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection lost'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(post('/templates', { name: 'Fixture' })).rejects.toMatchObject({
      code: 'network_unavailable', message: expect.stringMatching(/may already have changed local records.*before retrying/i),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports malformed successful writes as unknown without retaining response text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<private response text>')))
    let outcome: unknown
    try { await post('/templates', { name: 'Fixture' }) } catch (cause) { outcome = cause }
    expect(outcome).toBeInstanceOf(ApiError)
    expect(outcome).toMatchObject({ code: 'response_unverified', message: expect.stringMatching(/may already have changed local records/i) })
    expect(JSON.stringify(outcome)).not.toContain('private response text')
  })

  it('marks an unreadable server error on a write as unknown rather than a confirmed failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('proxy failure', { status: 502 })))
    await expect(post('/templates', {})).rejects.toMatchObject({ code: 'request_failed', message: expect.stringMatching(/do not assume it failed/i) })
  })

  it('does not start an already cancelled request', async () => {
    const cancellation = new AbortController(); cancellation.abort()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetchMock)
    await expect(api('/overview', { signal: cancellation.signal })).rejects.toMatchObject({ code: 'request_cancelled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['internal_error', 'unexpected_server_code'])('does not infer rollback from a structured 5xx write envelope: %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code, message: 'Could not save' } }, { status: 503 })))
    await expect(post('/templates', {})).rejects.toMatchObject({ code, message: expect.stringMatching(/may already have changed local records/i) })
  })

  it.each(['privacy_backup_failed', 'retirement_maintenance_busy'])('preserves an inspected pre-mutation refusal: %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code, message: 'Verified pre-mutation refusal' } }, { status: 503 })))
    await expect(post('/privacy/confirm', {})).rejects.toMatchObject({ code, message: 'Verified pre-mutation refusal' })
  })

  it('cancels a body read, releases the deadline and removes the caller listener', async () => {
    vi.useFakeTimers()
    const cancellation = new AbortController()
    const remove = vi.spyOn(cancellation.signal, 'removeEventListener')
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      signal = options.signal as AbortSignal
      return { ok: true, status: 200, json: () => new Promise(() => {}) }
    }))
    let outcome: unknown = 'pending'
    void api('/overview', { signal: cancellation.signal }).then((value) => { outcome = value }, (cause) => { outcome = cause })
    await vi.advanceTimersByTimeAsync(1)
    cancellation.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toMatchObject({ code: 'request_cancelled' })
    expect(signal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes the caller listener after success, so later cancellation cannot abort a completed request', async () => {
    const cancellation = new AbortController()
    const remove = vi.spyOn(cancellation.signal, 'removeEventListener')
    let signal: AbortSignal | undefined
    const payload = { ...operationalReads['/overview'], status: 'ok' }
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => { signal = options.signal as AbortSignal; return Response.json(payload) }))
    await expect(api('/overview', { signal: cancellation.signal })).resolves.toEqual(payload)
    cancellation.abort()
    expect(signal?.aborted).toBe(false)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('preserves a structured rejection and never trusts non-string envelope fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":{},"message":42}}', { status: 422 })))
    await expect(post('/templates', {})).rejects.toMatchObject({ code: 'request_failed', message: 'The request failed' })
  })
})
