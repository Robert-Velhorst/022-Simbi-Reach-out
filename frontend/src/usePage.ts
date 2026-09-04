import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Page } from './types'

// One bounded page at a time; obsolete searches must never replace newer results.
export function usePage<T>(path: string) {
  const [page, setPage] = useState<Page<T> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  const offset = useRef(0)
  const invalidate = useCallback(() => { request.current++ }, [])
  const load = useCallback(async (nextOffset = offset.current) => {
    const current = ++request.current
    setLoading(true); setError('')
    try {
      const result = await api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=50&offset=${nextOffset}`)
      if (current !== request.current) return
      offset.current = result.offset
      setPage(result)
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : 'Records could not be loaded')
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    offset.current = 0; setPage(null); void load(0)
    return invalidate
  }, [load, invalidate])
  return { page, error, loading, load }
}
