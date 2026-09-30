import type { ReactNode } from 'react'
import { Button, Notice } from './ui'

export function DataState({ label, loading, error, hasData, retry, children }: {
  label: string; loading: boolean; error: string; hasData: boolean; retry?: () => Promise<void>; children: ReactNode
}) {
  return <>
    {loading ? <Notice>{hasData ? `Refreshing ${label}… Showing the last loaded result.` : `Loading ${label}…`}</Notice> : null}
    {error ? <Notice tone="danger"><span>{error}</span>{' '}<span>{hasData ? 'Showing the last loaded result; it may be out of date.' : `No result is available for ${label}.`}</span>{retry ? <Button type="button" variant="quiet" disabled={loading} onClick={() => void retry()}>Retry</Button> : null}</Notice> : null}
    <div className="data-state" aria-busy={loading}>{hasData || (!loading && !error) ? children : null}</div>
  </>
}
