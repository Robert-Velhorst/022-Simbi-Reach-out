import { useI18n } from '../i18n'
import { useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, Clipboard, FilePlus2, ShieldAlert, Sparkles } from 'lucide-react'
import { api, ApiError, patch, post } from '../api'
import { Button, EmptyState, Field, Input, Modal, Notice, Panel, Select, Status, Textarea } from '../components/ui'
import type { Campaign, Draft, Member, Prospect, Template } from '../types'
import { usePage } from '../usePage'
import { PageNavigation } from '../components/PageNavigation'
import { DataState } from '../components/DataState'
import { hasEditVersion, verifiedDraft } from '../draftSave'

type Handoff = { id: number; draft_id: number; provider_url: string; subject: string; body: string; status: string; instruction: string; can_open_provider: boolean }
const checks = [
  ['source_authorized', 'I verified the source and may use this record.'],
  ['message_personalized', 'The message is specific, accurate and not deceptive.'],
  ['policy_reviewed', 'The message complies with the provider policy and applicable rules.'],
  ['manual_send_understood', 'I understand the app will not send this message.'],
] as const

export default function ReviewQueue({ member }: { member: Member; onMemberChange: (member: Member) => void }) {
  const { t, formatMessage, formatDate, formatCode } = useI18n()
  const canEdit = ['owner', 'admin', 'editor'].includes(member.role)
  const drafts = usePage<Draft>('/drafts')
  const campaigns = usePage<Campaign>('/campaigns?order=name')
  const prospects = usePage<Prospect>('/prospects?order=name')
  const templates = usePage<Template>('/templates?order=name')
  const data = { drafts: drafts.page?.items ?? [], campaigns: campaigns.page?.items ?? [], prospects: prospects.page?.items ?? [], templates: templates.page?.items ?? [] }
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [reviewChecks, setReviewChecks] = useState<{ key: string; values: string[] }>({ key: '', values: [] })
  const [edited, setEdited] = useState<{ key: string; id: number; version: string; subject: string; body: string } | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<{ previousVersion: string; draft: Draft } | null>(null)
  const [saveIssue, setSaveIssue] = useState<number | null>(null)
  const [comparison, setComparison] = useState<Draft | null>(null)
  const comparisonTrigger = useRef<HTMLButtonElement | null>(null)
  const comparisonReturnFocus = useRef<HTMLElement | null>(null)
  const editorForm = useRef<HTMLFormElement | null>(null)
  const saveInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const handoffTrigger = useRef<HTMLButtonElement | null>(null)
  const handoffKeys = useRef(new Map<string, string>())
  const [copyMessage, setCopyMessage] = useState('')
  const load = () => drafts.load()
  const listed = data.drafts.find((draft) => draft.id === selectedId) ?? data.drafts[0] ?? null
  const selected = savedSnapshot && listed?.id === savedSnapshot.draft.id && listed.edit_version === savedSnapshot.previousVersion ? savedSnapshot.draft : listed
  const selectedKey = selected ? `${selected.id}:${selected.content_hash}` : ''
  const editor = edited?.id === selected?.id ? edited : { id: selected?.id ?? 0, key: selectedKey, version: selected?.edit_version ?? '', subject: selected?.subject ?? '', body: selected?.body ?? '' }
  const dirty = selected ? editor.subject !== selected.subject || editor.body !== selected.body : false
  const checked = reviewChecks.key === selectedKey ? reviewChecks.values : []
  function setChecked(values: string[]) { setReviewChecks({ key: selectedKey, values }) }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit) return; setMessage(''); setBusy(true)
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await post('/drafts', { campaign_id: Number(values.campaign_id), prospect_id: Number(values.prospect_id), template_id: Number(values.template_id) })
      setCreateOpen(false); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Draft could not be created') }
    finally { setBusy(false) }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || !selected || busy || saveInFlight.current || !dirty || !hasEditVersion(editor.version) || saveIssue === selected.id) return
    const current = selected
    const submitted = { subject: editor.subject, body: editor.body }
    saveInFlight.current = true; setMessage(''); setBusy(true)
    try {
      const result = await patch<unknown>(`/drafts/${current.id}`, { ...submitted, expected_edit_version: editor.version })
      const saved = verifiedDraft(result, current.id, submitted)
      if (!saved || saved.edit_version === editor.version) throw new Error('The save result could not be verified. Keep your edits and check the saved version.')
      setSavedSnapshot({ previousVersion: current.edit_version, draft: saved })
      setSelectedId(current.id); setChecked([]); setEdited(null); setSaveIssue(null)
      await load()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'validation_failed') {
        setMessage(cause.message)
        return
      }
      setSaveIssue(current.id); setChecked([])
      setMessage(cause instanceof ApiError && cause.code === 'draft_save_conflict'
        ? 'The saved draft changed. Your unsaved edits remain here. Compare the saved version before saving.'
        : 'The save result could not be verified. Keep your edits and check the saved version.')
    } finally { saveInFlight.current = false; setBusy(false) }
  }

  async function checkSavedVersion() {
    if (!canEdit || !selected || busy) return
    const current = selected
    setMessage(''); setBusy(true)
    try {
      const saved = verifiedDraft(await api<unknown>(`/drafts/${current.id}`), current.id)
      if (!saved) throw new Error('The saved version could not be verified. Your unsaved edits remain here.')
      comparisonReturnFocus.current = comparisonTrigger.current
      setComparison(saved)
    } catch {
      setMessage('The saved version could not be verified. Your unsaved edits remain here.')
    } finally { setBusy(false) }
  }

  function chooseSavedVersion(keepEdits: boolean) {
    if (!selected || !listed || !comparison || comparison.id !== selected.id || busy) return
    comparisonReturnFocus.current = editorForm.current
    setSavedSnapshot({ previousVersion: listed.edit_version, draft: comparison })
    if (keepEdits) setEdited({ ...editor, id: comparison.id, key: `${comparison.id}:${comparison.content_hash}`, version: comparison.edit_version })
    else setEdited(null)
    setChecked([]); setSaveIssue(null); setComparison(null); setMessage('')
  }

  async function review(decision: 'approve' | 'decline') {
    if (!canEdit || !selected || busy || dirty || saveIssue === selected.id || (decision === 'approve' && !selected.content_hash)) return; setMessage(''); setBusy(true)
    try { await post(`/drafts/${selected.id}/review`, { decision, acknowledged_checks: checked, ...(decision === 'approve' ? { expected_content_hash: selected.content_hash } : {}) }); setChecked([]); await load() }
    catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Review could not be recorded')
      if (cause instanceof ApiError && cause.code === 'draft_changed') { setChecked([]); setEdited(null); await load() }
    }
    finally { setBusy(false) }
  }

  async function prepareHandoff() {
    if (!canEdit || !selected || busy || dirty || saveIssue === selected.id) return; setMessage(''); setBusy(true)
    try {
      const storageKey = `simbi-handoff-v1:${member.workspace_id}:${member.user_id}:${selected.id}:${selected.updated_at}`
      let key = handoffKeys.current.get(storageKey)
      if (!key) {
        try { key = sessionStorage.getItem(storageKey) ?? undefined } catch { /* In-memory recovery still works when storage is disabled. */ }
        key ??= crypto.randomUUID()
        handoffKeys.current.set(storageKey, key)
        try { sessionStorage.setItem(storageKey, key) } catch { /* No message content is persisted. */ }
      }
      const result = await post<Handoff>(`/drafts/${selected.id}/handoff`, {}, { 'Idempotency-Key': key })
      setCopyMessage(''); setHandoff(result); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Handoff could not be prepared') }
    finally { setBusy(false) }
  }

  async function resolveHandoff() {
    if (!selected) return
    setMessage(''); setBusy(true)
    try {
      const result = await api<{ items: Handoff[] }>(`/handoffs?draft_id=${selected.id}&limit=1`)
      if (!result.items.length) {
        setMessage('No handoff record was found. Check the audit log before changing this draft.')
        return
      }
      setCopyMessage(''); setHandoff(result.items[0])
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Handoff could not be loaded')
    } finally { setBusy(false) }
  }

  async function outcome(value: 'sent' | 'ambiguous' | 'cancelled') {
    if (!canEdit || !handoff || busy) return
    setMessage(''); setBusy(true)
    try { await post(`/handoffs/${handoff.id}/outcome`, { outcome: value }); handoffKeys.current.clear(); setHandoff(null); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Outcome could not be recorded') }
    finally { setBusy(false) }
  }

  async function copyHandoff() {
    if (!canEdit || !handoff || busy || handoff.can_open_provider !== true) return
    setBusy(true); setMessage(''); setCopyMessage('')
    try {
      const current = await revalidateHandoff()
      if (!current) return
      try { await navigator.clipboard.writeText(`${current.subject ? `${current.subject}\n\n` : ''}${current.body}`); setCopyMessage('Message copied. The app has not sent anything.') }
      catch { setCopyMessage('Could not copy the message. Select the approved text and copy it manually only while permission remains valid.') }
    } finally { setBusy(false) }
  }

  async function revalidateHandoff(): Promise<Handoff | null> {
    if (!handoff) return null
    try {
      const result = await api<{ items: Handoff[] }>(`/handoffs?draft_id=${handoff.draft_id}&limit=1`)
      const current = result.items.find((item) => item.id === handoff.id)
      if (!current || current.can_open_provider !== true) {
        setHandoff({ ...handoff, can_open_provider: false })
        return null
      }
      setHandoff(current)
      return current
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Current provider permission could not be verified. No action was taken.')
      return null
    }
  }

  async function openProvider() {
    if (!canEdit || !handoff || busy || handoff.can_open_provider !== true) return
    setBusy(true); setMessage('')
    try {
      const current = await revalidateHandoff()
      if (current) window.location.assign(current.provider_url)
    } finally { setBusy(false) }
  }

  const comparisonDialog = canEdit && comparison ? <Modal title={t("Compare saved draft")} returnFocusRef={comparisonReturnFocus} onClose={() => setComparison(null)}>
    <Notice tone="warning">{t("Compare the current saved text with your unsaved edits. Closing this dialog keeps your edits; no choice sends or approves a message.")}</Notice>
    <div className="settings-grid">
      <Panel title={t("Current saved version")}><Field label={t("Saved subject")}><Input readOnly value={comparison.subject} /></Field><Field label={t("Saved message")}><Textarea aria-label={t("Saved message")} readOnly rows={10} value={comparison.body} /></Field><Status value={comparison.state} /></Panel>
      <Panel title={t("Your unsaved edits")}><Field label={t("Unsaved subject")}><Input readOnly value={editor.subject} /></Field><Field label={t("Unsaved message")}><Textarea aria-label={t("Unsaved message")} readOnly rows={10} value={editor.body} /></Field></Panel>
    </div>
    <div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setComparison(null)}>{t("Keep editing")}</Button>
      <Button type="button" variant="secondary" onClick={() => chooseSavedVersion(false)}>{t(comparison.subject === editor.subject && comparison.body === editor.body ? "Use verified saved version" : "Discard my edits and use saved version")}</Button>
      {['needs_review', 'approved'].includes(comparison.state) && (comparison.subject !== editor.subject || comparison.body !== editor.body) ? <Button type="button" onClick={() => chooseSavedVersion(true)}>{t("Keep my edits for a new review")}</Button> : null}
    </div>
    <small>{t("Keeping your edits only updates the version you compared against. Press Save separately, then repeat all review checks. A later change will block that save again.")}</small>
  </Modal> : null

  return <div className="page review-page">
    {comparisonDialog}
    <header className="page-hero"><div><h1>{t("Review queue")}</h1><p>{t("Every message stays here until a human reviews its source, wording, policy context and intended manual action.")}</p></div>{canEdit ? <Button onClick={() => { setMessage(''); setCreateOpen(true) }}><FilePlus2 size={17} />{t("Prepare draft")}</Button> : null}</header>
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    {!member.compliance_ack_at ? <Notice tone="warning">{t("Approval is locked until an owner or admin completes the compliance review in Settings.")}</Notice> : null}
    {message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}
    {[campaigns, prospects, templates].map((source, index) => source.error ? <Notice key={index} tone="danger">{formatMessage(source.error)}<Button variant="quiet" onClick={() => void source.load()}>{t("Retry")}</Button></Notice> : null)}
    <PageNavigation page={drafts.page} loading={drafts.loading || busy} load={async (offset) => { setChecked([]); setEdited(null); setSelectedId(null); await drafts.load(offset) }} />
    <DataState label={t("drafts")} loading={drafts.loading} error={drafts.error} hasData={Boolean(data.drafts.length)} retry={drafts.load}>{data.drafts.length ? <div className="review-layout">
      <Panel className="review-list" title={t(data.drafts.length === 1 ? '{count} draft' : '{count} drafts', { count: data.drafts.length })}>
        {data.drafts.map((draft) => <button key={draft.id} disabled={busy} className={`review-item ${draft.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(draft.id); setChecked([]); setEdited(null); setMessage('') }}><div><strong>{draft.prospect_name}</strong><Status value={draft.state} /></div><span>{draft.campaign_name}</span><small>{t("Quality")}{' '}{draft.quality_score}/100 · {formatDate(draft.updated_at)}</small></button>)}
      </Panel>
      {selected ? <Panel className="review-detail" title={selected.prospect_name} action={<Status value={selected.state} />}>
        <div className="review-context"><div><span>{t("Campaign")}</span><strong>{selected.campaign_name}</strong></div><div><span>{t("Source context")}</span><a href={selected.source_url} target="_blank" rel="noreferrer">{t("Open reviewed source")}{' '}<ArrowUpRight size={14} /></a></div><div><span>{t("Consent")}</span><Status value={selected.consent_status} /></div><div><span>{t("Quality")}</span><strong>{selected.quality_score}/100</strong></div></div>
        {selected.safety_flags.length ? <Notice tone="warning"><strong>{t("Review signals:")}</strong> {selected.safety_flags.map((flag) => formatCode(flag)).join(', ')}{t(". These are prompts for judgment, not automatic rejection.")}</Notice> : <Notice tone="success">{t("The deterministic quality checks found no warnings. Human review is still required.")}</Notice>}
        {dirty ? <Notice tone="warning">{t("Save your changes, then repeat the review checks before approving or preparing a handoff.")}</Notice> : null}
        {canEdit && !hasEditVersion(editor.version) ? <Notice tone="warning">{t("The saved edit version is unavailable. Reload this page before saving.")}</Notice> : null}
        {canEdit && saveIssue === selected.id ? <Notice tone="warning">{t("Saving is paused until you check the saved version. This does not save, approve or send anything.")}<Button ref={comparisonTrigger} type="button" variant="secondary" disabled={busy} onClick={() => void checkSavedVersion()}>{t("Check saved version")}</Button></Notice> : null}
        <form ref={editorForm} tabIndex={-1} className="form-stack draft-editor" onSubmit={saveDraft}>
          <Field label={t("Subject")}><Input name="subject" maxLength={200} readOnly={!canEdit} value={editor.subject} onChange={(event) => setEdited({ ...editor, subject: event.target.value })} disabled={busy || !['needs_review', 'approved'].includes(selected.state)} /></Field>
          <Field label={t("Message")}><Textarea name="body" readOnly={!canEdit} rows={12} minLength={20} maxLength={5000} value={editor.body} onChange={(event) => setEdited({ ...editor, body: event.target.value })} disabled={busy || !['needs_review', 'approved'].includes(selected.state)} required /></Field>
          {canEdit && ['needs_review', 'approved'].includes(selected.state) ? <div className="editor-actions"><Button variant="secondary" disabled={busy || !dirty || !hasEditVersion(editor.version) || saveIssue === selected.id}>{t("Save and return to review")}</Button></div> : null}
        </form>
        {canEdit && selected.state === 'needs_review' ? <section className="approval-box"><h3><ShieldAlert size={19} />{t("Pre-action safety review")}</h3>{checks.map(([value, label]) => <label className="check-row" key={value}><input type="checkbox" checked={checked.includes(value)} onChange={(event) => setChecked(event.target.checked ? [...checked, value] : checked.filter((item) => item !== value))} /><span>{t(label)}</span></label>)}<div className="approval-actions"><Button variant="quiet" onClick={() => review('decline')} disabled={busy || dirty || saveIssue === selected.id}>{t("Decline")}</Button><Button onClick={() => review('approve')} disabled={busy || dirty || saveIssue === selected.id || !selected.content_hash || Boolean(drafts.error) || checked.length !== checks.length}><Check size={17} />{t("Approve for handoff")}</Button></div></section> : null}
        {canEdit && selected.state === 'approved' ? <section className="approval-box ready"><h3><Check size={19} />{t("Approved for assisted handoff")}</h3><p>{t("The next step prepares a copyable message and provider link. It will not log in, fill a form or send anything.")}</p><Button ref={handoffTrigger} onClick={(event) => { handoffTrigger.current = event.currentTarget; void prepareHandoff() }} disabled={busy || dirty || saveIssue === selected.id || Boolean(drafts.error) || member.demo_mode}><Clipboard size={17} />{t("Copy and open provider")}</Button>{member.demo_mode ? <small>{t("External handoffs are blocked in demo mode.")}</small> : null}</section> : null}
        {['ambiguous', 'handoff_created'].includes(selected.state) ? <section className="approval-box"><Notice tone="danger">{t("This handoff has no confirmed final outcome. Do not retry blindly. An owner, admin or editor must verify the provider conversation manually, then record the result.")}</Notice><Button variant="secondary" ref={handoffTrigger} onClick={(event) => { handoffTrigger.current = event.currentTarget; void resolveHandoff() }} disabled={busy}>{canEdit ? t("Resolve latest handoff") : t("View latest handoff")}</Button></section> : null}
      </Panel> : null}
    </div> : <Panel><EmptyState title={t("No drafts to review")} detail={t("Prepare a draft after you have a campaign, an authorized prospect record and a reusable template.")} action={canEdit ? <Button onClick={() => setCreateOpen(true)}><Sparkles size={17} />{t("Prepare first draft")}</Button> : null} /></Panel>}</DataState>
    {canEdit && createOpen ? <Modal title={t("Prepare a deterministic draft")} onClose={() => setCreateOpen(false)}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : <Notice>{t("Template placeholders are rendered locally. The result always starts in the review queue.")}</Notice>}<form className="form-stack" onSubmit={createDraft}><div><PageNavigation page={campaigns.page} loading={campaigns.loading} load={campaigns.load} /><Field label={t("Campaign")}><Select key={campaigns.page?.offset} name="campaign_id" disabled={campaigns.loading || Boolean(campaigns.error)} required defaultValue=""><option value="" disabled>{t("Select campaign")}</option>{data.campaigns.filter((campaign) => campaign.status !== 'archived').map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name} ({formatCode(campaign.status)})</option>)}</Select></Field></div><div><PageNavigation page={prospects.page} loading={prospects.loading} load={prospects.load} /><Field label={t("Prospect")}><Select key={prospects.page?.offset} name="prospect_id" disabled={prospects.loading || Boolean(prospects.error)} required defaultValue=""><option value="" disabled>{t("Select prospect")}</option>{data.prospects.filter((prospect) => !['opted_out', 'blocked'].includes(prospect.consent_status)).map((prospect) => <option value={prospect.id} key={prospect.id}>{prospect.name}{prospect.organization ? ` — ${prospect.organization}` : ''}</option>)}</Select></Field></div><div><PageNavigation page={templates.page} loading={templates.loading} load={templates.load} /><Field label={t("Template")}><Select key={templates.page?.offset} name="template_id" disabled={templates.loading || Boolean(templates.error)} required defaultValue=""><option value="" disabled>{t("Select template")}</option>{data.templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</Select></Field></div><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setCreateOpen(false)}>{t("Cancel")}</Button><Button disabled={busy || [campaigns, prospects, templates].some((source) => source.loading || Boolean(source.error))}>{t("Prepare draft")}</Button></div></form></Modal> : null}
    {handoff ? <Modal title={t("Manual provider handoff")} returnFocusRef={handoffTrigger} onClose={() => { if (!busy) setHandoff(null) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}{copyMessage ? <Notice>{formatMessage(copyMessage)}</Notice> : null}<Notice tone="warning">{t("The app has not sent anything. Verify what happened on the provider before recording an outcome; do not send again blindly.")}</Notice><Field label={t("Approved message")}><Textarea readOnly rows={12} value={`${handoff.subject ? `${handoff.subject}\n\n` : ''}${handoff.body}`} /></Field>{canEdit && handoff.can_open_provider === true ? <div className="handoff-actions"><Button variant="secondary" disabled={busy} onClick={copyHandoff}><Clipboard size={17} />{t("Copy message")}</Button><Button disabled={busy} onClick={openProvider}>{t("Open provider")}{' '}<ArrowUpRight size={17} /></Button><small>{t("Opens in this tab after checking permission. Use browser Back to return and resolve this handoff.")}</small></div> : <Notice tone="warning">{canEdit ? t("Review permissions changed. Copying and opening the provider are disabled. You may record the historical outcome only.") : t("Your viewer role can read this handoff history but cannot copy, open or record an outcome.")}</Notice>}{canEdit ? <div className="outcome-box"><strong>{t("After checking the provider, record the outcome:")}</strong><div><Button variant="secondary" disabled={busy} onClick={() => outcome('cancelled')}>{t("Not sent")}</Button><Button variant="danger" disabled={busy} onClick={() => outcome('ambiguous')}>{t("Unsure — needs verification")}</Button><Button disabled={busy} onClick={() => outcome('sent')}>{t("Sent manually")}</Button></div></div> : null}</Modal> : null}
  </div>
}
