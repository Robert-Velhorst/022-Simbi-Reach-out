import { useRef, useState } from 'react'
import { useSubmitFocus } from './useSubmitFocus'

export function usePendingMutation() {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const rememberFocus = useSubmitFocus(busy)
  return {
    busy,
    pending: () => inFlight.current,
    begin(form?: HTMLFormElement) {
      // State alone cannot guard two events before React's next render.
      if (inFlight.current) return false
      if (form) rememberFocus(form)
      else if (document.activeElement instanceof HTMLElement) rememberFocus(document.activeElement)
      inFlight.current = true; setBusy(true)
      return true
    },
    end() { inFlight.current = false; setBusy(false) },
  }
}
