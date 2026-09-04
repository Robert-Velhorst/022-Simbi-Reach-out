import { Button } from './ui'
import type { Page } from '../types'

export function PageNavigation({ page, loading, load }: { page: Page<unknown> | null; loading: boolean; load: (offset: number) => Promise<void> }) {
  if (!page || (page.total <= page.limit && page.offset === 0)) return null
  return <nav className="page-actions" aria-label="Record pages">
    <Button type="button" variant="secondary" disabled={loading || page.offset === 0} onClick={() => void load(Math.max(0, page.offset - page.limit))}>Previous page</Button>
    <span>{page.items.length ? `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} of ${page.total}` : `No records on this page · ${page.total} total`}</span>
    <Button type="button" variant="secondary" disabled={loading || page.offset + page.limit >= page.total} onClick={() => void load(page.offset + page.limit)}>Next page</Button>
  </nav>
}
