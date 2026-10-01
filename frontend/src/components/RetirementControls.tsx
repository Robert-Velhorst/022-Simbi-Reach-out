import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, post } from '../api'
import { useI18n, type TranslationKey } from '../i18n'
import { Button, Field, Input, Modal, Notice, Panel } from './ui'

export type RetirementReceipt = { kind: 'retirement'; plan_id: string; counts: Record<string, number>; backup_file: string; completed_at: string; replayed: boolean }
type Plan = { kind: 'retirement'; plan_id: string; counts: Record<string, number>; expires_at: string; owner_name: string; workspace_name: string }
const labels: Record<string, TranslationKey> = { users: 'Local accounts', workspaces: 'Workspaces', memberships: 'Memberships', sessions: 'Sign-in sessions', campaigns: 'Campaigns', prospects: 'Prospects', templates: 'Templates', drafts: 'Drafts', handoffs: 'Handoffs', replies: 'Replies', reminders: 'Reminders', suppressions: 'Do-not-contact identities', provider_settings: 'Provider settings', feature_flags: 'Feature settings', audit_events: 'Audit events', analytics_events: 'Analytics events', login_attempts: 'Sign-in protection records', privacy_cleanup_plans: 'Cleanup plans and receipts' }

export default function RetirementControls({ paused, onRetired }: { paused: boolean; onRetired: (receipt: RetirementReceipt) => void }) {
  const { t, formatDate, formatMessage } = useI18n()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const inProgress = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  function clearChecks() { setConfirmed(false); setAcknowledged(false); setTyped('') }
  function close() { if (!inProgress.current) { setOpen(false); clearChecks() } }
  async function action(work: () => Promise<void>) {
    if (inProgress.current) return
    inProgress.current = true; setBusy(true); setMessage('')
    try { await work() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Retirement could not be completed') }
    finally { inProgress.current = false; setBusy(false) }
  }
  function verifiedReceipt(value: RetirementReceipt, expected: Plan) {
    if (!value || value.kind !== 'retirement' || value.plan_id !== expected.plan_id || !value.counts
      || Object.keys(value.counts).length !== Object.keys(expected.counts).length
      || !Object.entries(expected.counts).every(([name, count]) => value.counts[name] === count)
      || typeof value.backup_file !== 'string' || !/^[A-Za-z0-9_.-]+\.db$/.test(value.backup_file)
      || !Number.isFinite(Date.parse(value.completed_at))) {
      throw new ApiError('retirement_receipt_unverified', 'The response was interrupted. Retirement is not confirmed; check the completion receipt before retrying.')
    }
    return value
  }
  async function preview() {
    setPlan(null); clearChecks(); setUncertain(false)
    await action(async () => setPlan(await post<Plan>('/privacy/retirement/preview', {})))
  }
  async function receiptLookup() {
    if (!plan) return
    await action(async () => {
      try { onRetired(verifiedReceipt(await api<RetirementReceipt>(`/privacy/retirement/receipt/${plan.plan_id}`), plan)) }
      catch (cause) {
        if (cause instanceof ApiError && cause.code === 'not_found') throw new Error('No completed receipt is available. Keep this preview and retry only after checking the service.', { cause })
        throw cause
      }
    })
  }
  async function retire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan || !confirmed || !acknowledged || typed !== 'RETIRE' || inProgress.current) return
    const form = event.currentTarget
    const passphrase = String(new FormData(form).get('retirement_password'))
    await action(async () => {
      try {
        onRetired(verifiedReceipt(await post<RetirementReceipt>('/privacy/retirement/confirm', { plan_id: plan.plan_id, current_password: passphrase, confirmed: true, acknowledged_loss: true, typed_confirmation: typed }), plan))
      } catch (cause) {
        if (cause instanceof ApiError && ['network_unavailable', 'request_timeout', 'authentication_required', 'session_expired', 'csrf_failed', 'internal_error', 'request_failed', 'retirement_receipt_unverified'].includes(cause.code)) {
          // A lost response can follow a successful commit and session removal.
          // The opaque preview token can read only the non-content receipt.
          setUncertain(true)
          try { onRetired(verifiedReceipt(await api<RetirementReceipt>(`/privacy/retirement/receipt/${plan.plan_id}`), plan)); return }
          catch { throw new Error('The response was interrupted. Retirement is not confirmed; check the completion receipt before retrying.') }
        }
        if (cause instanceof ApiError && ['privacy_preview_required', 'privacy_preview_changed', 'privacy_preview_expired', 'current_password_invalid', 'retirement_pause_required', 'retirement_personal_only', 'privacy_in_flight'].includes(cause.code)) { setPlan(null); setOpen(false) }
        throw cause
      } finally { form.reset(); clearChecks() }
    })
  }
  const warning = t('Retirement removes this local account, workspace, contacts, conversations, settings, sessions and do-not-contact history. It permanently blocks new setup here. Simbi, backups, exports and HAI copies are not deleted. This is not secure erasure.')
  const feedback = message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null
  return <><Panel title={t('Retire personal installation')}>
    <p className="panel-intro">{t('For one local owner and one workspace only. Shared installations are protected. Enable the safety stop and resolve all uncertain handoffs first.')}</p>
    <Notice tone="warning">{warning}</Notice>
    {!paused ? <p>{t('Enable the emergency safety stop above before previewing retirement.')}</p> : null}
    {!open ? feedback : null}
    <Button variant="secondary" disabled={busy || !paused || uncertain} onClick={() => void preview()}>{busy ? t('Working…') : t('Preview personal retirement')}</Button>
    {plan ? <div className="form-stack">
      <h3>{t('Personal retirement preview')}</h3>
      <p>{t('Local owner: {owner}. Workspace: {workspace}.', { owner: plan.owner_name, workspace: plan.workspace_name })}</p>
      <p>{t('Expires at {date}.', { date: formatDate(plan.expires_at) })}</p>
      <dl className="definition-list">{Object.entries(plan.counts).map(([name, count]) => <div key={name}><dt>{labels[name] ? t(labels[name]) : name}</dt><dd>{count}</dd></div>)}</dl>
      <p>{t('A verified recovery backup of this paused workspace is required before deletion. Changes after this preview require a new preview.')}</p>
      <Button ref={trigger} variant="danger" disabled={busy || uncertain} onClick={() => { clearChecks(); setMessage(''); setOpen(true) }}>{t('Review personal retirement')}</Button>
      {uncertain ? <Button variant="secondary" disabled={busy} onClick={() => void receiptLookup()}>{t('Check completion receipt')}</Button> : null}
      <Button variant="secondary" disabled={busy || uncertain} onClick={() => { setPlan(null); setMessage('') }}>{t('Discard preview')}</Button>
    </div> : null}
  </Panel>
  {open && plan ? <Modal title={t('Confirm personal retirement')} onClose={close} closeDisabled={busy} returnFocusRef={trigger}>
    <form className="form-stack" onSubmit={retire}>
      <p>{t('Local owner: {owner}. Workspace: {workspace}.', { owner: plan.owner_name, workspace: plan.workspace_name })}</p>
      <Notice tone="warning">{warning}</Notice>{feedback}
      <label><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />{t('I reviewed the exact counts and want to remove this personal installation.')}</label>
      <label><input type="checkbox" required checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />{t('I accept the loss of do-not-contact history and will protect or remove remaining private copies separately.')}</label>
      <Field label={t('Type RETIRE to confirm')}><Input value={typed} required disabled={busy} autoComplete="off" onChange={(event) => setTyped(event.target.value)} /></Field>
      <Field label={t('Local account password')}><Input name="retirement_password" type="password" required maxLength={200} disabled={busy} autoComplete="current-password" /></Field>
      <Button variant="danger" disabled={busy || !confirmed || !acknowledged || typed !== 'RETIRE' || uncertain}>{busy ? t('Working…') : t('Retire this installation')}</Button>
      {uncertain ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void receiptLookup()}>{t('Check completion receipt')}</Button> : null}
      <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t('Cancel')}</Button>
    </form>
  </Modal> : null}</>
}
