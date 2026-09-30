import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePage } from './usePage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('ignores stale search responses that arrive after a newer query', async () => {
  let finishOld!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('old') ? new Promise<Response>((resolve) => { finishOld = resolve }) : Promise.resolve(new Response(JSON.stringify({ items: ['new'], total: 1, limit: 50, offset: 0 })))))
  const { result, rerender } = renderHook(({ query }) => usePage<string>(query), { initialProps: { query: '/prospects?search=old' } })
  rerender({ query: '/prospects?search=new' })
  await waitFor(() => expect(result.current.page?.items).toEqual(['new']))
  await act(async () => { finishOld(new Response(JSON.stringify({ items: ['old'], total: 1, limit: 50, offset: 0 }))) })
  expect(result.current.page?.items).toEqual(['new'])
})

it('clears previous rows and errors as soon as the query changes', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('new')
    ? new Promise<Response>((finish) => { resolve = finish })
    : Promise.resolve(Response.json({ items: ['old'], total: 1, limit: 50, offset: 0 }))))
  const { result, rerender } = renderHook(({ query }) => usePage<string>(query), { initialProps: { query: '/prospects?search=old' } })
  await waitFor(() => expect(result.current.page?.items).toEqual(['old']))
  rerender({ query: '/prospects?search=new' })
  expect(result.current.page).toBeNull()
  expect(result.current.loading).toBe(true)
  expect(result.current.error).toBe('')
  await act(async () => { resolve(Response.json({ items: [], total: 0, limit: 50, offset: 0 })) })
  expect(result.current.page?.items).toEqual([])
  expect(result.current.loading).toBe(false)
})

it('retries the requested failed page rather than silently returning to the previous page', async () => {
  const offsets: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'))
    offsets.push(offset)
    if (offsets.length === 2) return Response.json({ error: { message: 'Temporary page failure' } }, { status: 503 })
    return Response.json({ items: [offset], total: 51, limit: 50, offset })
  }))
  const { result } = renderHook(() => usePage<number>('/audit'))
  await waitFor(() => expect(result.current.page?.offset).toBe(0))
  await act(async () => { await result.current.load(50) })
  expect(result.current.error).toBe('Temporary page failure')
  expect(result.current.page?.offset).toBe(0)
  await act(async () => { await result.current.load() })
  expect(result.current.page?.offset).toBe(50)
  expect(offsets).toEqual([0, 50, 50])
})
