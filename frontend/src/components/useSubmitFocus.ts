import { useEffect, useRef } from 'react'

export function useSubmitFocus(busy: boolean) {
  const target = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy) return
    const control = target.current
    target.current = null
    // Disabling a submitter can leave focus on BODY. Restore after enabling,
    // never while another control or an outside window has taken focus.
    if (control?.isConnected && document.hasFocus() && document.activeElement === document.body) control.focus()
  }, [busy])
  return (form: HTMLFormElement) => {
    target.current = document.activeElement instanceof HTMLElement && form.contains(document.activeElement) ? document.activeElement : null
  }
}
