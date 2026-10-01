import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, post } from '../api'
import { useI18n, type TranslationKey } from '../i18n'
import { Button, Field, Input, Modal, Notice, Panel, Select } from './ui'

type Kind = 'retention' | 'prospect' | 'campaign' | 'template'
type Counts = { prospects: number; drafts: number; handoffs: number; replies: number; reminders: number; campaigns?: number; templates?: number; template_links?: number; restricted_contacts?: number; audit_events?: number }
type Plan = { kind: Kind; plan_id: string; expires_at: string; cutoff: string; retention_days: number; counts: Counts; contacts: Array<{ id: number; name: string }>; records?: Array<{ id: number; name: string }>; restricted_contacts?: Array<{ id: number; name: string }>; protected_contacts: number; remaining_eligible_contacts: number; after_id: number | null; scanned_contacts: number; oversized_contacts: number; has_more_contacts: boolean; next_after_id: number | null }
type Receipt = { kind: Kind | 'audit_redaction'; plan_id: string; counts: Partial<Counts>; backup_file: string; completed_at: string; replayed: boolean }
type Contacts = { items: Array<{ id: number; name: string; source_url?: string }>; total: number }
const countLabels: Record<keyof Counts, TranslationKey> = { prospects: 'Prospects', drafts: 'Drafts', handoffs: 'Handoffs', replies: 'Replies', reminders: 'Reminders', campaigns: 'Campaigns', templates: 'Templates', template_links: 'Template links cleared', restricted_contacts: 'Contacts retained as do-not-contact', audit_events: 'Audit events' }
const selectionLabels: Record<Exclude<Kind, 'retention'>, { path: string; search: TranslationKey; find: TranslationKey; select: TranslationKey; choose: TranslationKey }> = {
  prospect: { path: 'prospects', search: 'Search contacts for removal', find: 'Find contacts', select: 'Contact to remove', choose: 'Choose a contact' },
  campaign: { path: 'campaigns', search: 'Search campaigns for removal', find: 'Find campaigns', select: 'Campaign to remove', choose: 'Choose a campaign' },
  template: { path: 'templates', search: 'Search templates for removal', find: 'Find templates', select: 'Template to remove', choose: 'Choose a template' },
}

function validCounts(value: Partial<Counts>, kind: Receipt['kind']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = kind === 'audit_redaction' ? ['audit_events'] : ['prospects', 'drafts', 'handoffs', 'replies', 'reminders', ...(kind === 'campaign' ? ['campaigns', 'restricted_contacts'] : kind === 'template' ? ['templates', 'template_links'] : [])]
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || !Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0)) return false
  if (kind === 'audit_redaction') return value.audit_events! > 0 && value.audit_events! <= 50
  if (kind === 'retention' || kind === 'prospect') return value.prospects! <= (kind === 'prospect' ? 1 : 50)
  return value.prospects === 0 && (kind === 'campaign' ? value.campaigns === 1 : value.templates === 1)
}

function validReceipt(value: Receipt, expected?: Plan) {
  return value && ['retention', 'prospect', 'campaign', 'template', 'audit_redaction'].includes(value.kind)
    && /^[a-f0-9]{32}$/.test(value.plan_id) && validCounts(value.counts, value.kind)
    && (value.kind === 'campaign' || value.kind === 'template' || value.kind === 'audit_redaction' || value.counts.prospects! > 0)
    && typeof value.replayed === 'boolean' && typeof value.backup_file === 'string'
    && /^[A-Za-z0-9_.-]+\.db$/.test(value.backup_file) && typeof value.completed_at === 'string' && Number.isFinite(Date.parse(value.completed_at))
    && (!expected || (value.kind === expected.kind && value.plan_id === expected.plan_id
      && Object.keys(expected.counts).every((key) => value.counts[key as keyof Counts] === expected.counts[key as keyof Counts])))
}

function validPlan(value: Plan, kind: Kind, afterId: number, selectedId: number) {
  if (!value || value.kind !== kind || !/^[a-f0-9]{32}$/.test(value.plan_id)
    || !validCounts(value.counts, kind) || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) || typeof value.cutoff !== 'string' || !Number.isFinite(Date.parse(value.cutoff))
    || !Number.isInteger(value.retention_days) || value.retention_days < 30 || value.retention_days > 3650) return false
  const validRecords = (rows: Plan['contacts']) => Array.isArray(rows) && rows.every((item) => item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.name === 'string') && new Set(rows.map(({ id }) => id)).size === rows.length
  if (!validRecords(value.contacts) || value.contacts.length !== value.counts.prospects) return false
  if (kind !== 'retention') {
    const selected = kind === 'prospect' ? value.contacts : value.records
    return !!selected && validRecords(selected) && selected.length === 1 && selected[0].id === selectedId
      && (kind !== 'campaign' || (!!value.restricted_contacts && validRecords(value.restricted_contacts) && value.restricted_contacts.length === value.counts.restricted_contacts))
  }
  return value.after_id === afterId && value.contacts.every(({ id }) => id > afterId)
    && [value.scanned_contacts, value.protected_contacts, value.oversized_contacts, value.remaining_eligible_contacts].every((count) => Number.isInteger(count) && count >= 0)
    && value.scanned_contacts <= 1000 && value.oversized_contacts <= value.protected_contacts
    && value.counts.prospects + value.remaining_eligible_contacts + value.protected_contacts === value.scanned_contacts
    && typeof value.has_more_contacts === 'boolean'
    && (value.has_more_contacts ? Number.isSafeInteger(value.next_after_id) && value.next_after_id! > afterId && value.contacts.every(({ id }) => id <= value.next_after_id!) : value.next_after_id === null)
}

export default function PrivacyControls({ retentionDays, onSaved }: { retentionDays: number; onSaved: () => Promise<void> }) {
  const { t, formatDate, formatMessage } = useI18n()
  const [kind, setKind] = useState<Kind>('retention')
  const [contacts, setContacts] = useState<Contacts | null>(null)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [prospectId, setProspectId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [receipts, setReceipts] = useState<Receipt[] | null>(null)
  const [locatedReceipt, setLocatedReceipt] = useState<Receipt | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const inProgress = useRef(false)
  const selection = kind === 'retention' ? null : selectionLabels[kind]
  const removalCount = plan ? plan.counts.prospects + (plan.counts.campaigns ?? 0) + (plan.counts.templates ?? 0) : 0
  function receiptText(item: Receipt) {
    if (item.kind === 'audit_redaction') return t('Audit minimization recorded at {date}. Events updated: {count}. Recovery file: {file}.', { date: formatDate(item.completed_at), count: item.counts.audit_events ?? 0, file: item.backup_file })
    const key = item.kind === 'campaign' ? 'Cleanup recorded at {date}. Campaigns removed: {count}. Recovery file: {file}.' : item.kind === 'template' ? 'Cleanup recorded at {date}. Templates removed: {count}. Recovery file: {file}.' : 'Cleanup recorded at {date}. Contacts removed: {count}. Recovery file: {file}.'
    return t(key, { date: formatDate(item.completed_at), count: item.kind === 'campaign' ? item.counts.campaigns ?? 0 : item.kind === 'template' ? item.counts.templates ?? 0 : item.counts.prospects ?? 0, file: item.backup_file })
  }

  async function action(work: () => Promise<void>) {
    if (inProgress.current) return
    inProgress.current = true; setBusy(true); setMessage(null)
    try { await work() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Cleanup could not be completed') }
    finally { inProgress.current = false; setBusy(false) }
  }
  function resetPreview() { setPlan(null); setReceipt(null); setConfirmed(false); setMessage(null) }
  async function searchContacts(nextOffset = 0) {
    if (!selection) return
    resetPreview()
    await action(async () => {
      setContacts(null); setProspectId('')
      const result = await api<Contacts>(`/${selection.path}?limit=50&offset=${nextOffset}&search=${encodeURIComponent(search)}&order=name`)
      setContacts(result); setOffset(nextOffset)
    })
  }
  async function saveRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inProgress.current) return
    const days = Number(new FormData(event.currentTarget).get('retention_days'))
    resetPreview(); setCursor(0)
    await action(async () => {
      await post('/settings/retention', { retention_days: days })
      setMessage('Retention preference saved. No personal records were automatically deleted.')
      await onSaved()
    })
  }
  async function createPreview(afterId = cursor) {
    if (inProgress.current) return
    resetPreview(); setCursor(afterId)
    await action(async () => {
      const result = await post<Plan>('/privacy/preview', kind === 'retention' ? { kind, after_id: afterId } : { kind, [`${kind}_id`]: Number(prospectId) })
      if (!validPlan(result, kind, afterId, Number(prospectId))) throw new Error('The cleanup preview could not be verified; no confirmation is available.')
      setPlan(result)
    })
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan || !confirmed || inProgress.current) return
    const form = event.currentTarget
    const password = String(new FormData(form).get('cleanup_password'))
    await action(async () => {
      try {
        const result = await post<Receipt>('/privacy/confirm', { plan_id: plan.plan_id, current_password: password, confirmed: true })
        if (!validReceipt(result, plan)) throw new ApiError('privacy_receipt_unverified', 'Cleanup is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.')
        setReceipt(result); setReceipts(null); setPlan(null); setContacts(null); setProspectId(''); setShowConfirmation(false)
      } catch (cause) {
        // Keep the same plan after transport/backup failures for idempotent retry.
        if (cause instanceof ApiError && ['privacy_preview_required', 'privacy_preview_changed', 'privacy_preview_expired'].includes(cause.code)) {
          setPlan(null); setShowConfirmation(false)
        }
        if (cause instanceof ApiError && ['network_unavailable', 'request_timeout', 'request_cancelled', 'response_unverified', 'internal_error', 'request_failed'].includes(cause.code)) throw new Error('Cleanup is not confirmed. Keep this preview, check receipts or retry it; do not assume failure.', { cause })
        throw cause
      } finally { form.reset(); setConfirmed(false) }
    })
  }
  function close() {
    if (inProgress.current) return
    setShowConfirmation(false); setConfirmed(false)
  }
  async function findReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inProgress.current) return
    const reference = String(new FormData(event.currentTarget).get('receipt_reference')).trim()
    setLocatedReceipt(null)
    await action(async () => {
      let result: Receipt
      try { result = await api<Receipt>(`/privacy/receipts/${encodeURIComponent(reference)}`) }
      catch (cause) {
        if (cause instanceof ApiError && cause.code === 'response_unverified') throw new Error('Cleanup receipts could not be verified.', { cause })
        throw cause
      }
      if (!validReceipt(result) || result.plan_id !== reference) throw new Error('Cleanup receipts could not be verified.')
      setLocatedReceipt(result)
    })
  }
  const feedback = message ? <Notice tone={message.startsWith('Retention preference saved') ? 'success' : 'danger'}>{formatMessage(message)}</Notice> : null
  return <><Panel title={t('Privacy & cleanup')}>
    <p className="panel-intro">{t('Only the owner can remove local records. Preview first; nothing is sent to or deleted from Simbi.')}</p>
    {!showConfirmation ? feedback : null}
    <form className="form-stack" onSubmit={saveRetention}>
      <Field label={t('Keep inactive contact history for (days)')} hint={t('30–3650 days. This is your preference, not a legal retention rule or automatic deletion schedule.')}><Input name="retention_days" type="number" min={30} max={3650} required defaultValue={retentionDays} disabled={busy} /></Field>
      <Button variant="secondary" disabled={busy}>{t('Save retention preference')}</Button>
    </form>
    <div className="form-stack">
      <Field label={t('Cleanup scope')}><Select value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as Kind); resetPreview(); setContacts(null); setProspectId(''); setSearch(''); setOffset(0); setCursor(0) }}><option value="retention">{t('Old, closed contact history')}</option><option value="prospect">{t('One selected contact and all its local history')}</option><option value="campaign">{t('One campaign and its conversation history')}</option><option value="template">{t('One reusable template; keep its drafts')}</option></Select></Field>
      <small>{t('Age-based cleanup protects active campaigns, recent activity, open reminders and uncertain handoffs. At most 50 contacts are removed per preview.')}</small>
      {selection ? <>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void searchContacts() }}><Field label={t(selection.search)}><Input value={search} maxLength={200} disabled={busy} onChange={(event) => { setSearch(event.target.value); setContacts(null); setProspectId(''); resetPreview() }} /></Field><Button variant="secondary" disabled={busy}>{t(selection.find)}</Button></form>
        {contacts ? <><small>{t(kind === 'prospect' ? 'Found {total} contacts; showing {start}–{end}.' : 'Found {total} records; showing {start}–{end}.', { total: contacts.total, start: contacts.items.length ? offset + 1 : 0, end: offset + contacts.items.length })}</small><Field label={t(selection.select)}><Select value={prospectId} disabled={busy} onChange={(event) => { setProspectId(event.target.value); resetPreview() }}><option value="">{t(selection.choose)}</option>{contacts.items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.source_url ? ` — ${item.source_url}` : ''}</option>)}</Select></Field><div className="button-stack"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => void searchContacts(offset - 50)}>{t('Previous')}</Button><Button variant="secondary" disabled={busy || offset + contacts.items.length >= contacts.total} onClick={() => void searchContacts(offset + 50)}>{t('Next')}</Button></div></> : null}
      </> : null}
      <Button variant="secondary" disabled={busy || (kind !== 'retention' && !prospectId)} onClick={() => void createPreview()}>{busy ? t('Working…') : t('Preview cleanup')}</Button>
      {kind === 'retention' && cursor > 0 ? <Button variant="secondary" disabled={busy} onClick={() => void createPreview(0)}>{t('Restart contact scan')}</Button> : null}
    </div>
    {plan ? <div className="form-stack">
      <h3>{t('Removal preview')}</h3><p>{t('Expires at {date}.', { date: formatDate(plan.expires_at) })}</p>
      <p>{t('Cleanup reference: {reference}.', { reference: plan.plan_id })}</p>
      {kind === 'retention' ? <><p>{t('Only activity before {date} is eligible. This scan page: {scanned} checked, {protected} protected, including {oversized} oversized histories. Selected: {selected}; further eligible contacts on this page: {remaining}.', { date: formatDate(plan.cutoff), scanned: plan.scanned_contacts, protected: plan.protected_contacts, oversized: plan.oversized_contacts, selected: plan.counts.prospects, remaining: plan.remaining_eligible_contacts })}</p><small>{t('At most 1000 contacts are scanned per page and 50 removed per confirmation. Each linked history is limited to 1000 records. Protected records remain; scan counts are not workspace totals. Restart to recheck earlier contacts after changes.')}</small>{plan.has_more_contacts ? <Notice>{t('More contacts remain beyond this scan page. Finish its selected batches before moving to the next page.')}</Notice> : null}</> : null}
      <dl className="definition-list">{Object.entries(countLabels).filter(([table]) => plan.counts[table as keyof Counts] !== undefined).map(([table, label]) => <div key={table}><dt>{t(label)}</dt><dd>{plan.counts[table as keyof Counts]}</dd></div>)}</dl>
      {removalCount ? <ul>{[...plan.contacts, ...(plan.records ?? [])].map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <Notice>{t('No contacts in this preview will be removed.')}</Notice>}
      {plan.restricted_contacts?.length ? <section><h4>{t('Contacts retained as do-not-contact')}</h4><ul>{plan.restricted_contacts.map((item) => <li key={item.id}>{item.name}</li>)}</ul></section> : null}
      <Notice tone="warning">{t(kind === 'campaign' ? 'The selected campaign, its drafts, handoffs, replies and draft-linked reminders will be removed. Contacts remain but affected identities become do-not-contact. Other campaigns, templates, audit history, backups and exports remain.' : kind === 'template' ? 'Only the reusable template is removed. Existing draft text, approvals and conversation history remain; their template links are cleared. Audit history, backups and exports remain.' : 'Contact details, drafts, handoffs, replies and linked reminders will be removed. Campaigns, templates, audit history and do-not-contact identities remain. Backups and prior exports still contain old data; this is not secure erasure.')}</Notice>
      <Button ref={trigger} variant="danger" disabled={busy || !removalCount} onClick={() => { setConfirmed(false); setMessage(null); setShowConfirmation(true) }}>{t('Review removal')}</Button>
      {kind === 'retention' && plan.has_more_contacts && plan.next_after_id !== null ? <Button variant="secondary" disabled={busy || removalCount > 0} onClick={() => void createPreview(plan.next_after_id!)}>{t('Next contact scan page')}</Button> : null}
      <Button variant="secondary" disabled={busy} onClick={resetPreview}>{t('Discard preview')}</Button>
    </div> : null}
    {receipt ? <Notice tone="success">{receiptText(receipt)}<p>{t('Cleanup reference: {reference}.', { reference: receipt.plan_id })}</p>{receipt.replayed ? <p>{t('This is the existing receipt; the removal was not repeated.')}</p> : null}</Notice> : null}
    <small>{t('Recovery copies contain private records and local login data. Keep them protected. A full restore can bring back removed data and old restrictions; review safety settings before resuming.')}</small>
    <Button variant="secondary" disabled={busy} onClick={() => void action(async () => { setReceipts(null); const result = await api<{ items: Receipt[] }>('/privacy/receipts'); if (!Array.isArray(result?.items) || !result.items.every((item) => validReceipt(item))) throw new Error('Cleanup receipts could not be verified.'); setReceipts(result.items) })}>{t('Check cleanup receipts')}</Button>
    {receipts ? receipts.length ? <ul>{receipts.map((item) => <li key={item.plan_id}>{receiptText(item)}<p>{t('Cleanup reference: {reference}.', { reference: item.plan_id })}</p></li>)}</ul> : <Notice>{t('No completed cleanup receipts were found for your account.')}</Notice> : null}
    <form className="form-stack" onSubmit={findReceipt}>
      <Field label={t('Cleanup reference')} hint={t('Keep the preview reference before closing this page. Look up an older receipt after reload; absence from the last ten is not proof of failure.')}><Input aria-label={t('Cleanup reference')} name="receipt_reference" pattern="[a-f0-9]{32}" maxLength={32} required autoComplete="off" disabled={busy} /></Field>
      <Button variant="secondary" disabled={busy}>{t('Find cleanup receipt by reference')}</Button>
    </form>
    {locatedReceipt ? <Notice>{receiptText(locatedReceipt)}<p>{t('Cleanup reference: {reference}.', { reference: locatedReceipt.plan_id })}</p></Notice> : null}
  </Panel>
    {showConfirmation && plan ? <Modal title={t('Confirm local removal')} onClose={close} returnFocusRef={trigger} closeDisabled={busy}>
      <form className="form-stack" onSubmit={remove}>
        <Notice tone="warning">{t(kind === 'campaign' || kind === 'template' ? 'Remove the selected record and apply exactly the changes listed in your preview? A verified recovery copy is required before any removal.' : 'Remove {count} contacts and the history listed in your preview? A verified recovery copy is required before any removal.', { count: plan.counts.prospects })}</Notice>
        {feedback}
        <label className="check-row"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />{t('I reviewed the exact removal list and understand that backups, exports and do-not-contact records remain.')}</label>
        <Field label={t('Local account password')}><Input name="cleanup_password" type="password" maxLength={200} required autoComplete="current-password" disabled={busy} /></Field>
        <Button variant="danger" disabled={busy || !confirmed}>{busy ? t('Working…') : t('Confirm removal')}</Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={close}>{t('Cancel')}</Button>
        <small>{t('If the response is interrupted, retry this same preview to retrieve its receipt. Do not assume removal failed.')}</small>
      </form>
    </Modal> : null}
  </>
}
