import { useI18n } from '../i18n'
import type { ReactNode } from 'react'
import { Button, Notice } from './ui'

export function DataState({ label, loading, error, hasData, retry, children }: {
  label: string; loading: boolean; error: string; hasData: boolean; retry?: () => Promise<void>; children: ReactNode
}) {
  const { t, formatMessage } = useI18n()
  return <>
    {loading ? <Notice>{hasData ? t('Refreshing {resource}… Showing the last loaded result.', { resource: label }) : t('Loading {resource}…', { resource: label })}</Notice> : null}
    {error ? <Notice tone="danger"><span>{formatMessage(error)}</span>{' '}<span>{hasData ? t("Showing the last loaded result; it may be out of date.") : t('No result is available for {resource}.', { resource: label })}</span>{retry ? <Button type="button" variant="quiet" disabled={loading} onClick={() => void retry()}>{t("Retry")}</Button> : null}</Notice> : null}
    <div className="data-state" aria-busy={loading}>{hasData || (!loading && !error) ? children : null}</div>
  </>
}
