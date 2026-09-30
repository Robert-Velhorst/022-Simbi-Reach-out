import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

// Overview and report reads share the same pending, retry and stale-response rules.
export function useResource<T>(path: string) {
  const [state, setState] = useState<{ path: string; data: T | null; error: string; loading: boolean }>({ path, data: null, error: '', loading: true })
  const request = useRef(0)
  const invalidate = useCallback(() => { request.current++ }, [])
  const load = useCallback(async () => {
    const current = ++request.current
    setState((previous) => ({ path, data: previous.path === path ? previous.data : null, error: '', loading: true }))
    try {
      const data = await api<T>(path)
      if (current === request.current) setState({ path, data, error: '', loading: false })
    } catch (cause) {
      if (current === request.current) setState((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : 'Data could not be loaded', loading: false }))
    }
  }, [path])
  useEffect(() => {
    void load()
    return invalidate
  }, [load, invalidate])
  const current = state.path === path ? state : { data: null, error: '', loading: true }
  return { data: current.data, error: current.error, loading: current.loading, load }
}
