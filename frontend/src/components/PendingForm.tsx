import type { ComponentProps } from 'react'
import { useI18n } from '../i18n'
import { Notice } from './ui'

export function PendingForm({ busy, className, children, ...props }: ComponentProps<'form'> & { busy: boolean }) {
  const { t } = useI18n()
  return <>{busy ? <Notice>{t('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.')}</Notice> : null}<form {...props} className={className} aria-busy={busy} tabIndex={busy ? 0 : undefined}>
    <fieldset disabled={busy} className={`pending-fields ${className ?? ''}`}>{children}</fieldset>
  </form></>
}
