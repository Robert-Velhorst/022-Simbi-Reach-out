import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Button, Modal, Notice } from './ui'

type Protection = { unresolved: boolean; pending: boolean; returnFocus: RefObject<HTMLElement | null> }
type Guard = { protect: (value: Protection | null) => void; requestLeave: (action: () => void) => void }
const DraftLeaveContext = createContext<Guard | null>(null)

export function useDraftLeave() {
  const guard = useContext(DraftLeaveContext)
  if (!guard) throw new Error('Draft leave protection requires DraftLeaveGuard')
  return guard.requestLeave
}

export function useDraftProtection(unresolved: boolean, pending: boolean, returnFocus: RefObject<HTMLElement | null>) {
  const guard = useContext(DraftLeaveContext)
  if (!guard) throw new Error('Draft leave protection requires DraftLeaveGuard')
  const { protect } = guard
  useLayoutEffect(() => { protect({ unresolved, pending, returnFocus }) }, [protect, unresolved, pending, returnFocus])
  useLayoutEffect(() => () => protect(null), [protect])
  return guard.requestLeave
}

// One guard covers route/history navigation, editor-replacing local actions and
// best-effort browser unload. It holds flags and a pending action, never draft text.
export default function DraftLeaveGuard({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [status, setStatus] = useState({ unresolved: false, pending: false })
  const [asking, setAsking] = useState(false)
  const protection = useRef<Protection | null>(null)
  const localAction = useRef<(() => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const blocker = useBlocker(useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const changesLocation = currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash
    return changesLocation && Boolean(protection.current?.unresolved || protection.current?.pending)
  }, []))

  const protect = useCallback((value: Protection | null) => {
    protection.current = value
    const unresolved = Boolean(value?.unresolved)
    const pending = Boolean(value?.pending)
    setStatus((previous) => previous.unresolved === unresolved && previous.pending === pending ? previous : { unresolved, pending })
  }, [])
  const requestLeave = useCallback((action: () => void) => {
    if (!protection.current?.unresolved && !protection.current?.pending) { action(); return }
    // A second action must not silently replace an already visible choice.
    if (localAction.current) return
    returnFocus.current = protection.current?.returnFocus.current ?? null
    localAction.current = action
    setAsking(true)
  }, [])
  const context = useMemo(() => ({ protect, requestLeave }), [protect, requestLeave])

  useLayoutEffect(() => {
    if (blocker.state === 'blocked') returnFocus.current = protection.current?.returnFocus.current ?? null
  }, [blocker.state])
  useEffect(() => {
    if (!status.unresolved && !status.pending) return
    // Native browser text and availability are controlled by the browser. This
    // cannot recover text after crashes, forced closure or security revocation.
    const warn = (event: BeforeUnloadEvent) => {
      if (!protection.current?.unresolved && !protection.current?.pending) return
      event.preventDefault()
      event.returnValue = ' '
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status.unresolved, status.pending])

  function keepEditing() {
    localAction.current = null
    setAsking(false)
    if (blocker.state === 'blocked') blocker.reset()
  }
  function continueWithoutSaving() {
    if (protection.current?.pending) return
    const action = localAction.current
    localAction.current = null
    setAsking(false)
    if (blocker.state === 'blocked') blocker.proceed()
    else action?.()
  }

  return <DraftLeaveContext.Provider value={context}>
    {children}
    {asking || blocker.state === 'blocked' ? <Modal title={t('Leave this draft?')} returnFocusRef={returnFocus} onClose={keepEditing}>
      <Notice tone="warning">{t('Your local edits or save result are unresolved. Continuing discards this editor state, not the saved draft. Nothing is saved, approved or sent automatically.')}</Notice>
      {status.pending ? <Notice>{t('A draft request is still pending. Stay here until it finishes, then check its result before leaving.')}</Notice> : null}
      <div className="form-stack">
        <p>{t('Choose Keep editing to return and save or check the saved version yourself. Browser warnings cannot recover text after a crash or forced closure.')}</p>
        <div className="modal-actions"><Button type="button" onClick={keepEditing}>{t('Keep editing')}</Button><Button type="button" variant="danger" disabled={status.pending} onClick={continueWithoutSaving}>{t('Discard local edits and continue')}</Button></div>
      </div>
    </Modal> : null}
  </DraftLeaveContext.Provider>
}
