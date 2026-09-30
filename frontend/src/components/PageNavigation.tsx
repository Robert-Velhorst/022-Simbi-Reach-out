import { useI18n } from '../i18n'
import { Button } from './ui'
import type { Page } from '../types'

export function PageNavigation({ page, loading, load }: { page: Page<unknown> | null; loading: boolean; load: (offset: number) => Promise<void> }) {
  const { t } = useI18n()
  if (!page || (page.total <= page.limit && page.offset === 0)) return null
  return <nav className="page-actions" aria-label={t("Record pages")}>
    <Button type="button" variant="secondary" disabled={loading || page.offset === 0} onClick={() => void load(Math.max(0, page.offset - page.limit))}>{t("Previous page")}</Button>
    <span>{page.items.length ? t('{first}–{last} of {total}', { first: page.offset + 1, last: Math.min(page.offset + page.items.length, page.total), total: page.total }) : t('No records on this page · {total} total', { total: page.total })}</span>
    <Button type="button" variant="secondary" disabled={loading || page.offset + page.limit >= page.total} onClick={() => void load(page.offset + page.limit)}>{t("Next page")}</Button>
  </nav>
}
