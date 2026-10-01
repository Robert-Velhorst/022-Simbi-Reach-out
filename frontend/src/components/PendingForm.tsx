import { useLayoutEffect, useRef, type ComponentProps } from 'react'
import { useI18n } from '../i18n'
import { Notice } from './ui'

export function PendingForm({ busy, className, children, ...props }: ComponentProps<'form'> & { busy: boolean }) {
  const { t } = useI18n()
  const formRef = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    const form = formRef.current
    const active = document.activeElement
    // Keep native Tab/scroll within the dialog after disabling its submitter,
    // without reclaiming another control or background document's focus.
    if (busy && form && document.hasFocus() && (active === document.body || (active instanceof HTMLElement && form.contains(active)))) form.focus({ preventScroll: true })
  }, [busy])
  return <>{busy ? <Notice>{t('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.')}</Notice> : null}<form {...props} ref={formRef} className={className} aria-busy={busy} tabIndex={busy ? 0 : undefined}>
    <fieldset disabled={busy} className={`pending-fields ${className ?? ''}`}>{children}</fieldset>
  </form></>
}
