import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, post } from '../api'
import { useI18n, type TranslationKey } from '../i18n'
import { Button, Field, Input, Modal, Notice, Panel } from './ui'

type AuditEvent = { id: number; event_type: string; entity_type: string; entity_id: string; created_at: string; fields: Array<'reason' | 'base_url' | 'checks'> }
type Plan = { kind: 'audit_redaction'; plan_id: string; expires_at: string; cutoff: string; retention_days: number; counts: { audit_events: number }; events: AuditEvent[]; after_id: number; scanned_events: number; protected_events: number; unchanged_events: number; remaining_eligible_events: number; has_more_events: boolean; next_after_id: number | null }
type Receipt = { kind: 'audit_redaction'; plan_id: string; counts: { audit_events: number }; backup_file: string; completed_at: string; replayed: boolean }
const labels: Record<AuditEvent['fields'][number], TranslationKey> = { reason: 'Duplicate restriction reason', base_url: 'Duplicate provider URL', checks: 'Unrecognized review-check text' }

function validReceipt(value: Receipt, expected?: Plan) {
  return value?.kind === 'audit_redaction' && /^[a-f0-9]{32}$/.test(value.plan_id)
    && Number.isInteger(value.counts?.audit_events) && value.counts.audit_events > 0 && value.counts.audit_events <= 50
    && Object.keys(value.counts).length === 1 && typeof value.replayed === 'boolean'
    && typeof value.backup_file === 'string' && /^[A-Za-z0-9_.-]+\.db$/.test(value.backup_file)
    && Number.isFinite(Date.parse(value.completed_at))
    && (!expected || (value.plan_id === expected.plan_id && value.counts.audit_events === expected.counts.audit_events))
}

export default function AuditPrivacyControls() {
  const { t, formatDate, formatMessage } = useI18n()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [cursor, setCursor] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [receipts, setReceipts] = useState<Receipt[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const pending = useRef(false)
  async function action(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setMessage('')
    try { await work() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Audit minimization could not be completed') }
    finally { pending.current = false; setBusy(false) }
  }
  async function preview(afterId = cursor) {
    if (pending.current) return
    setPlan(null); setReceipt(null); setConfirmed(false); setCursor(afterId)
    await action(async () => {
      const result = await post<Plan>('/privacy/audit/preview', { after_id: afterId })
      if (!result || result.kind !== 'audit_redaction' || !/^[a-f0-9]{32}$/.test(result.plan_id)
        || !Number.isInteger(result.counts?.audit_events) || result.counts.audit_events < 0 || result.counts.audit_events > 50
        || !Array.isArray(result.events) || result.events.length !== result.counts.audit_events
        || result.after_id !== afterId || !Number.isFinite(Date.parse(result.expires_at))
        || !result.events.every((item) => Number.isInteger(item.id) && item.id > afterId && Array.isArray(item.fields) && item.fields.length > 0 && item.fields.every((field) => Object.hasOwn(labels, field)))) {
        throw new Error('The audit preview could not be verified; no confirmation is available.')
      }
      setPlan(result)
    })
  }
  function receiptText(item: Receipt) { return t('Audit minimization recorded at {date}. Events updated: {count}. Recovery file: {file}.', { date: formatDate(item.completed_at), count: item.counts.audit_events, file: item.backup_file }) }
  async function minimize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan || !confirmed || pending.current) return
    const form = event.currentTarget
    const password = String(new FormData(form).get('audit_password'))
    await action(async () => {
      try {
        const result = await post<Receipt>('/privacy/audit/confirm', { plan_id: plan.plan_id, current_password: password, confirmed: true })
        if (!validReceipt(result, plan)) throw new ApiError('audit_receipt_unverified', 'Audit minimization is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.')
        setReceipt(result); setReceipts(null); setPlan(null); setOpen(false)
      } catch (cause) {
        if (cause instanceof ApiError && ['privacy_preview_required', 'privacy_preview_changed', 'privacy_preview_expired'].includes(cause.code)) { setPlan(null); setOpen(false) }
        if (cause instanceof ApiError && ['network_unavailable', 'request_timeout', 'internal_error', 'request_failed'].includes(cause.code)) throw new Error('Audit minimization is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.', { cause })
        throw cause
      } finally { form.reset(); setConfirmed(false) }
    })
  }
  function close() { if (!pending.current) { setOpen(false); setConfirmed(false) } }
  const feedback = message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null
  return <><Panel title={t('Minimize old audit details')}>
    <p className="panel-intro">{t('Owner-only cleanup of known duplicate text, not audit-event deletion. Nothing is changed on Simbi.')}</p>
    <Notice tone="warning">{t('Only old duplicate restriction reasons, provider URLs and unrecognized review-check text are eligible. Event identities, actors, timestamps, recognized checks, restriction records and provider settings remain. Backups and exports still contain old data; this is not secure erasure.')}</Notice>
    {!open ? feedback : null}
    <Button variant="secondary" disabled={busy} onClick={() => void preview()}>{busy ? t('Working…') : t('Preview old audit details')}</Button>
    {cursor > 0 ? <Button variant="secondary" disabled={busy} onClick={() => void preview(0)}>{t('Restart audit scan')}</Button> : null}
    {plan ? <div className="form-stack">
      <h3>{t('Audit detail preview')}</h3>
      <p>{t('Expires at {date}.', { date: formatDate(plan.expires_at) })}</p>
      <p>{t('Events before {date} only. This scan page: {scanned} checked, {protected} protected, {unchanged} unchanged. Selected: {selected}; further eligible events on this page: {remaining}.', { date: formatDate(plan.cutoff), scanned: plan.scanned_events, protected: plan.protected_events, unchanged: plan.unchanged_events, selected: plan.counts.audit_events, remaining: plan.remaining_eligible_events })}</p>
      <small>{t('At most 1000 known event types are scanned per page and 50 events changed per confirmation. Recent or malformed entries are protected; other fields and event types are not scrubbed. A new privacy preview replaces your other pending previews.')}</small>
      {plan.events.length ? <ul>{plan.events.map((item) => <li key={item.id}>{t('Event {id}: {type}; {entity} {entityId}; {date}. Fields: {fields}.', { id: item.id, type: item.event_type, entity: item.entity_type, entityId: item.entity_id, date: formatDate(item.created_at), fields: item.fields.map((field) => t(labels[field])).join(', ') })}</li>)}</ul> : <Notice>{t('No eligible duplicate text was selected on this scan page. This does not mean all history is free of personal data.')}</Notice>}
      {plan.has_more_events ? <Notice>{t('More events remain beyond this scan page. Process its selected batches before moving to the next page.')}</Notice> : null}
      <Button ref={trigger} variant="danger" disabled={busy || !plan.counts.audit_events} onClick={() => { setConfirmed(false); setMessage(''); setOpen(true) }}>{t('Review audit minimization')}</Button>
      {plan.has_more_events && plan.next_after_id !== null ? <Button variant="secondary" disabled={busy || plan.counts.audit_events > 0} onClick={() => void preview(plan.next_after_id!)}>{t('Next audit scan page')}</Button> : null}
      <Button variant="secondary" disabled={busy} onClick={() => { setPlan(null); setMessage('') }}>{t('Discard preview')}</Button>
    </div> : null}
    {receipt ? <Notice tone="success">{receiptText(receipt)}{receipt.replayed ? <p>{t('This is the existing receipt; the audit update was not repeated.')}</p> : null}</Notice> : null}
    <small>{t('Recovery copies contain private records and local login data. Keep them protected. A full restore can bring back removed data and old restrictions; review safety settings before resuming.')}</small>
    <Button variant="secondary" disabled={busy} onClick={() => void action(async () => { setReceipts(null); const result = await api<{ items: Receipt[] }>('/privacy/audit/receipts'); if (!Array.isArray(result.items) || !result.items.every((item) => validReceipt(item))) throw new Error('Audit receipts could not be verified.'); setReceipts(result.items) })}>{t('Check audit minimization receipts')}</Button>
    {receipts ? receipts.length ? <ul>{receipts.map((item) => <li key={item.plan_id}>{receiptText(item)}</li>)}</ul> : <Notice>{t('No completed audit minimization receipts were found for your account.')}</Notice> : null}
  </Panel>
    {open && plan ? <Modal title={t('Confirm audit minimization')} onClose={close} returnFocusRef={trigger} closeDisabled={busy}>
      <form className="form-stack" onSubmit={minimize}>
        <Notice tone="warning">{t('Update only the listed duplicate fields in {count} old audit events? A verified recovery copy of the original data is required first.', { count: plan.counts.audit_events })}</Notice>
        {feedback}
        <label className="check-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />{t('I reviewed the exact audit fields and understand that operational records, backups and exports remain.')}</label>
        <Field label={t('Local account password')}><Input name="audit_password" type="password" maxLength={200} required autoComplete="current-password" disabled={busy} /></Field>
        <Button variant="danger" disabled={busy || !confirmed}>{busy ? t('Working…') : t('Confirm audit update')}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t('Cancel')}</Button>
        <small>{t('If the response is interrupted, retry the same preview or check audit receipts. Do not assume the update failed.')}</small>
      </form>
    </Modal> : null}
  </>
}
