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
