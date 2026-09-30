import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useResource } from './useResource'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('ignores obsolete successes and failures after changing the resource', async () => {
  let finishOld!: (value: Response) => void
  let finishNew!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((resolve) => {
    if (url.includes('old')) finishOld = resolve
    else finishNew = resolve
  })))
  const { result, rerender } = renderHook(({ path }) => useResource<string>(path), { initialProps: { path: '/old' } })
  rerender({ path: '/new' })
  await act(async () => { finishOld(Response.json({ error: { message: 'Obsolete failure' } }, { status: 503 })) })
  expect(result.current.error).toBe('')
  expect(result.current.loading).toBe(true)
  await act(async () => { finishNew(Response.json('new')) })
  expect(result.current.data).toBe('new')
  expect(result.current.loading).toBe(false)
})

it('lets the newest refresh win and ignores a response after unmount', async () => {
  const pending: Array<(value: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve) })))
  const { result, unmount } = renderHook(() => useResource<string>('/overview'))
  let refresh!: Promise<void>
  act(() => { refresh = result.current.load() })
  await act(async () => { pending[1](Response.json('new')); await refresh })
  await waitFor(() => expect(result.current.data).toBe('new'))
  await act(async () => { pending[0](Response.json('old')) })
  expect(result.current.data).toBe('new')
  act(() => { void result.current.load() })
  unmount()
  await act(async () => { pending[2](Response.json('unmounted')) })
  expect(result.current.data).toBe('new')
})
