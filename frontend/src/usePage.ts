import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { validPage } from './coreResponse'
import type { Page } from './types'

// One bounded page at a time; obsolete searches must never replace newer results.
export function usePage<T>(path: string) {
  const [state, setState] = useState<{ path: string; page: Page<T> | null; error: string; loading: boolean }>({ path, page: null, error: '', loading: true })
  const request = useRef(0)
  const offset = useRef(0)
  const invalidate = useCallback(() => { request.current++ }, [])
  const load = useCallback(async (nextOffset = offset.current) => {
    const current = ++request.current
    offset.current = nextOffset
    setState((previous) => ({ path, page: previous.path === path ? previous.page : null, error: '', loading: true }))
    try {
      const result = await api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=50&offset=${nextOffset}`)
      if (current !== request.current) return
      if (!validPage(result, nextOffset, 50)) throw new ApiError('response_unverified', 'The local service returned an unreadable response. Reload the current records; no result was verified.')
      offset.current = result.offset
      setState({ path, page: result, error: '', loading: false })
    } catch (cause) {
      if (current === request.current) setState((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : 'Records could not be loaded', loading: false }))
    }
  }, [path])
  useEffect(() => {
    offset.current = 0; void load(0)
    return invalidate
  }, [load, invalidate])
  // A changed search is pending immediately, before its effect starts the request.
  // Never expose the previous query's rows or error as the new query's result.
  const current = state.path === path ? state : { page: null, error: '', loading: true }
  return { page: current.page, error: current.error, loading: current.loading, load }
}
