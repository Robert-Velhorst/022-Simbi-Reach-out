import { useI18n, type TranslationKey } from '../i18n'
import { Notice } from './ui'

export function CreationRetryNotice({ reference, action }: { reference: string | null; action: TranslationKey }) {
  const { t } = useI18n()
  return reference ? <Notice tone="warning">{t('{action} retry reference: {reference}. Retry the original values to check the same attempt. Changed values cannot reuse a committed reference. Cancel clears the fields, not this reference. After navigation, reload, sign-out or closure, check saved records before creating again.', { action: t(action), reference })}</Notice> : null
}
