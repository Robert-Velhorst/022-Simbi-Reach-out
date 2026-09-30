import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, post } from '../api'
import { useI18n, type TranslationKey } from '../i18n'
import { Button, Field, Input, Modal, Notice, Panel, Select } from './ui'

type Counts = { prospects: number; drafts: number; handoffs: number; replies: number; reminders: number }
type Plan = { plan_id: string; expires_at: string; cutoff: string; retention_days: number; counts: Counts; contacts: Array<{ id: number; name: string }>; protected_contacts: number; remaining_eligible_contacts: number }
type Receipt = { plan_id: string; counts: Counts; backup_file: string; completed_at: string; replayed: boolean }
type Contacts = { items: Array<{ id: number; name: string; source_url: string }>; total: number }
const countLabels: Record<keyof Counts, TranslationKey> = { prospects: 'Prospects', drafts: 'Drafts', handoffs: 'Handoffs', replies: 'Replies', reminders: 'Reminders' }

export default function PrivacyControls({ retentionDays, onSaved }: { retentionDays: number; onSaved: () => Promise<void> }) {
  const { t, formatDate, formatMessage } = useI18n()
  const [kind, setKind] = useState('retention')
  const [contacts, setContacts] = useState<Contacts | null>(null)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [prospectId, setProspectId] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [receipts, setReceipts] = useState<Receipt[] | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const inProgress = useRef(false)

  async function action(work: () => Promise<void>) {
    if (inProgress.current) return
    inProgress.current = true; setBusy(true); setMessage(null)
    try { await work() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Cleanup could not be completed') }
    finally { inProgress.current = false; setBusy(false) }
  }
  function resetPreview() { setPlan(null); setReceipt(null); setConfirmed(false); setMessage(null) }
  async function searchContacts(nextOffset = 0) {
    resetPreview()
    await action(async () => {
      setContacts(null); setProspectId('')
      const result = await api<Contacts>(`/prospects?limit=50&offset=${nextOffset}&search=${encodeURIComponent(search)}&order=name`)
      setContacts(result); setOffset(nextOffset)
    })
  }
  async function saveRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const days = Number(new FormData(event.currentTarget).get('retention_days'))
    resetPreview()
    await action(async () => {
      await post('/settings/retention', { retention_days: days })
      setMessage('Retention preference saved. No personal records were automatically deleted.')
      await onSaved()
    })
  }
  async function createPreview() {
    resetPreview()
    await action(async () => setPlan(await post<Plan>('/privacy/preview', kind === 'retention' ? { kind } : { kind, prospect_id: Number(prospectId) })))
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!plan || !confirmed || inProgress.current) return
    const form = event.currentTarget
    const password = String(new FormData(form).get('cleanup_password'))
    await action(async () => {
      try {
        const result = await post<Receipt>('/privacy/confirm', { plan_id: plan.plan_id, current_password: password, confirmed: true })
        setReceipt(result); setPlan(null); setContacts(null); setProspectId(''); setShowConfirmation(false)
      } catch (cause) {
        // Keep the same plan after transport/backup failures for idempotent retry.
        if (cause instanceof ApiError && ['privacy_preview_required', 'privacy_preview_changed', 'privacy_preview_expired'].includes(cause.code)) {
          setPlan(null); setShowConfirmation(false)
        }
        throw cause
      } finally { form.reset(); setConfirmed(false) }
    })
  }
  function close() {
    if (inProgress.current) return
    setShowConfirmation(false); setConfirmed(false)
  }
  const feedback = message ? <Notice tone={message.startsWith('Retention preference saved') ? 'success' : 'danger'}>{formatMessage(message)}</Notice> : null
  return <><Panel title={t('Privacy & cleanup')}>
    <p className="panel-intro">{t('Only the owner can remove local contact history. Preview first; nothing is sent to or deleted from Simbi.')}</p>
    {!showConfirmation ? feedback : null}
    <form className="form-stack" onSubmit={saveRetention}>
      <Field label={t('Keep inactive contact history for (days)')} hint={t('30–3650 days. This is your preference, not a legal retention rule or automatic deletion schedule.')}><Input name="retention_days" type="number" min={30} max={3650} required defaultValue={retentionDays} disabled={busy} /></Field>
      <Button variant="secondary" disabled={busy}>{t('Save retention preference')}</Button>
    </form>
    <div className="form-stack">
      <Field label={t('Cleanup scope')}><Select value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value); resetPreview(); setContacts(null); setProspectId('') }}><option value="retention">{t('Old, closed contact history')}</option><option value="prospect">{t('One selected contact and all its local history')}</option></Select></Field>
      <small>{t('Age-based cleanup protects active campaigns, recent activity, open reminders and uncertain handoffs. At most 50 contacts are removed per preview.')}</small>
      {kind === 'prospect' ? <>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void searchContacts() }}><Field label={t('Search contacts for removal')}><Input value={search} maxLength={200} disabled={busy} onChange={(event) => { setSearch(event.target.value); setContacts(null); setProspectId(''); resetPreview() }} /></Field><Button variant="secondary" disabled={busy}>{t('Find contacts')}</Button></form>
        {contacts ? <><small>{t('Found {total} contacts; showing {start}–{end}.', { total: contacts.total, start: contacts.items.length ? offset + 1 : 0, end: offset + contacts.items.length })}</small><Field label={t('Contact to remove')}><Select value={prospectId} disabled={busy} onChange={(event) => { setProspectId(event.target.value); resetPreview() }}><option value="">{t('Choose a contact')}</option>{contacts.items.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.source_url}</option>)}</Select></Field><div className="button-stack"><Button variant="secondary" disabled={busy || offset === 0} onClick={() => void searchContacts(offset - 50)}>{t('Previous')}</Button><Button variant="secondary" disabled={busy || offset + contacts.items.length >= contacts.total} onClick={() => void searchContacts(offset + 50)}>{t('Next')}</Button></div></> : null}
      </> : null}
      <Button variant="secondary" disabled={busy || (kind === 'prospect' && !prospectId)} onClick={() => void createPreview()}>{busy ? t('Working…') : t('Preview cleanup')}</Button>
    </div>
    {plan ? <div className="form-stack">
      <h3>{t('Removal preview')}</h3><p>{t('Expires at {date}.', { date: formatDate(plan.expires_at) })}</p>
      {kind === 'retention' ? <p>{t('Only activity before {date} is eligible. Protected old contacts: {protected}. More eligible contacts after this batch: {remaining}.', { date: formatDate(plan.cutoff), protected: plan.protected_contacts, remaining: plan.remaining_eligible_contacts })}</p> : null}
      <dl className="definition-list">{Object.entries(countLabels).map(([table, label]) => <div key={table}><dt>{t(label)}</dt><dd>{plan.counts[table as keyof Counts]}</dd></div>)}</dl>
      {plan.contacts.length ? <ul>{plan.contacts.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <Notice>{t('No contacts in this preview will be removed.')}</Notice>}
      <Notice tone="warning">{t('Contact details, drafts, handoffs, replies and linked reminders will be removed. Campaigns, templates, audit history and do-not-contact identities remain. Backups and prior exports still contain old data; this is not secure erasure.')}</Notice>
      <Button ref={trigger} variant="danger" disabled={busy || !plan.counts.prospects} onClick={() => { setConfirmed(false); setMessage(null); setShowConfirmation(true) }}>{t('Review removal')}</Button>
      <Button variant="secondary" disabled={busy} onClick={resetPreview}>{t('Discard preview')}</Button>
    </div> : null}
    {receipt ? <Notice tone="success">{t('Cleanup recorded at {date}. Contacts removed: {count}. Recovery file: {file}.', { date: formatDate(receipt.completed_at), count: receipt.counts.prospects, file: receipt.backup_file })}{receipt.replayed ? <p>{t('This is the existing receipt; the removal was not repeated.')}</p> : null}</Notice> : null}
    <small>{t('Recovery copies contain private records and local login data. Keep them protected. A full restore can bring back removed data and old restrictions; review safety settings before resuming.')}</small>
    <Button variant="secondary" disabled={busy} onClick={() => void action(async () => { setReceipts(null); setReceipts((await api<{ items: Receipt[] }>('/privacy/receipts')).items) })}>{t('Check cleanup receipts')}</Button>
    {receipts ? receipts.length ? <ul>{receipts.map((item) => <li key={item.plan_id}>{t('Cleanup recorded at {date}. Contacts removed: {count}. Recovery file: {file}.', { date: formatDate(item.completed_at), count: item.counts.prospects, file: item.backup_file })}</li>)}</ul> : <Notice>{t('No completed cleanup receipts were found for your account.')}</Notice> : null}
  </Panel>
    {showConfirmation && plan ? <Modal title={t('Confirm local removal')} onClose={close} returnFocusRef={trigger} closeDisabled={busy}>
      <form className="form-stack" onSubmit={remove}>
        <Notice tone="warning">{t('Remove {count} contacts and the history listed in your preview? A verified recovery copy is required before any removal.', { count: plan.counts.prospects })}</Notice>
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
