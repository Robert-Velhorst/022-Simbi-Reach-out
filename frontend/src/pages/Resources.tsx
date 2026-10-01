import { useI18n, type UiMessage } from '../i18n'
import { useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, FilePlus2, Plus, Search, Upload, X } from 'lucide-react'
import { ApiError, patch, post } from '../api'
import { usePage } from '../usePage'
import { PendingForm } from '../components/PendingForm'
import { usePendingMutation } from '../components/usePendingMutation'
import { PageNavigation } from '../components/PageNavigation'
import { DataState } from '../components/DataState'
import { Button, EmptyState, Field, Input, Modal, Notice, Panel, Select, Status, TableRegion, Textarea } from '../components/ui'
import type { Campaign, Member, Prospect, Template } from '../types'

export function ProspectsPage({ canEdit }: { canEdit: boolean }) {
  const { t, formatMessage } = useI18n()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'create' | 'import' | null>(null)
  const [message, setMessage] = useState<UiMessage>('')
  const [stopTarget, setStopTarget] = useState<Prospect | null>(null)
  const action = usePendingMutation()
  const stopReturnFocus = useRef<HTMLElement | null>(null)
  const { page, load, loading, error } = usePage<Prospect>(`/prospects?search=${encodeURIComponent(search)}&order=name`)

  async function stopContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || !stopTarget || action.pending()) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (reason.length < 3 || reason.length > 500) { setMessage('Enter a reason between 3 and 500 characters.'); return }
    if (!action.begin(event.currentTarget)) return
    setMessage('')
    try {
      await post('/suppressions', { prospect_id: stopTarget.id, reason })
      // A successful stop disables its trigger. Restore a stable, named reading
      // destination instead; cancellation/failure still keep the original button.
      stopReturnFocus.current = stopReturnFocus.current?.closest<HTMLElement>('.table-wrap') ?? null
      setStopTarget(null); await load()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Contact could not be stopped') }
    finally { action.end() }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit || !action.begin(event.currentTarget)) return; setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      await post('/prospects', Object.fromEntries(form)); setModal(null); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not add prospect') }
    finally { action.end() }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit || !action.begin(event.currentTarget)) return; setMessage('')
    const form = new FormData(event.currentTarget)
    const csvText = String(form.get('csv_text') ?? '')
    try {
      const preview = await post<{ valid: number; errors: { line: number; message: string }[] }>('/prospects/import', { csv_text: csvText, commit: false })
      if (preview.errors.length) { setMessage({ key: '{count} row(s) need attention. First error: line {line} — {detail}', params: { count: preview.errors.length, line: preview.errors[0].line }, detail: preview.errors[0].message }); return }
      await post('/prospects/import', { csv_text: csvText, commit: true }); setModal(null); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Import failed') }
    finally { action.end() }
  }

  return <PageFrame title={t("Prospects")} detail={t("Only add people from a source you are authorized to use. This product does not scrape or harvest platform data.")} actions={canEdit ? <><Button variant="secondary" onClick={() => { setMessage(''); setModal('import') }}><Upload size={17} />{t("Import CSV")}</Button><Button onClick={() => { setMessage(''); setModal('create') }}><Plus size={17} />{t("Add prospect")}</Button></> : null}>
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    <SearchBar value={search} onChange={setSearch} placeholder={t("Search name, organization or notes")} />
    {message && !modal ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {canEdit && stopTarget ? <Modal title={t('Stop contact: {name}', { name: stopTarget.name })} returnFocusRef={stopReturnFocus} closeDisabled={action.busy} onClose={() => { if (!action.pending()) setStopTarget(null) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}<Notice tone="warning">{t("This records an opt-out and blocks further outreach to this prospect. Existing records remain available for reference and audit.")}</Notice><PendingForm busy={action.busy} className="form-stack" onSubmit={stopContact}><Field label={t("Reason")}><Textarea name="reason" required minLength={3} maxLength={500} rows={4} /></Field><div className="modal-actions"><Button type="button" variant="quiet" disabled={action.busy} onClick={() => setStopTarget(null)}>{t("Cancel")}</Button><Button variant="danger" disabled={action.busy}>{t("Confirm stop contact")}</Button></div></PendingForm></Modal> : null}
    <Panel><DataState label={t("prospects")} loading={loading} error={error} hasData={Boolean(page?.items.length)} retry={load}>{page?.items.length ? <TableRegion label={t("Prospects")}><table><thead><tr><th>{t("Name")}</th><th>{t("Organization")}</th><th>{t("Provider")}</th><th>{t("Consent context")}</th><th>{t("Source")}</th><th>{t("Contact safety")}</th></tr></thead><tbody>
      {page.items.map((prospect) => <tr key={prospect.id}><td><strong>{prospect.name}</strong><small>{prospect.contact_handle || t("No handle stored")}</small></td><td>{prospect.organization || '—'}</td><td>{prospect.provider}</td><td><Status value={prospect.consent_status} /></td><td><a className="table-action" href={prospect.source_url} target="_blank" rel="noreferrer">{t("Open source")}{' '}<ArrowUpRight size={14} /></a></td><td>{canEdit ? <Button variant="danger" disabled={action.busy || ['opted_out', 'blocked'].includes(prospect.consent_status)} onClick={(event) => { stopReturnFocus.current = event.currentTarget; setMessage(''); setStopTarget(prospect) }}>{t("Stop contact")}</Button> : t("Read-only")}</td></tr>)}
    </tbody></table></TableRegion> : <EmptyState title={t("No prospects")} detail={t("Add a prospect manually or import a reviewed CSV. Name and an HTTPS source URL are required.")} action={canEdit ? <Button onClick={() => setModal('create')}><Plus size={17} />{t("Add the first prospect")}</Button> : null} />}</DataState></Panel>
    {canEdit && modal === 'create' ? <Modal title={t("Add prospect")} closeDisabled={action.busy} onClose={() => { if (!action.pending()) setModal(null) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}<PendingForm busy={action.busy} className="form-grid" onSubmit={create}><Field label={t("Name")}><Input name="name" required minLength={2} maxLength={120} /></Field><Field label={t("Organization")}><Input name="organization" maxLength={160} /></Field><Field label={t("Provider")}><Input name="provider" defaultValue="simbi" required minLength={2} maxLength={40} /></Field><Field label={t("Source URL")} hint={t("Must be an HTTPS page you are authorized to use.")}><Input name="source_url" type="url" required maxLength={1000} placeholder="https://simbi.com/..." /></Field><Field label={t("Contact handle")}><Input name="contact_handle" maxLength={160} /></Field><Field label={t("Consent context")}><Select name="consent_status" defaultValue="unknown"><option value="unknown">{t("Unknown — review required")}</option><option value="contextual">{t("Contextual request")}</option><option value="consented">{t("Explicit consent")}</option><option value="opted_out">{t("Opted out")}</option><option value="blocked">{t("Blocked")}</option></Select></Field><Field label={t("Notes")}><Textarea name="notes" rows={4} maxLength={3000} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(null)}>{t("Cancel")}</Button><Button>{t("Add prospect")}</Button></div></PendingForm></Modal> : null}
    {canEdit && modal === 'import' ? <Modal title={t("Import reviewed prospects")} closeDisabled={action.busy} onClose={() => { if (!action.pending()) setModal(null) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : <Notice>{t("Preview validation runs before any record is written. Duplicate provider/source pairs are skipped.")}</Notice>}<PendingForm busy={action.busy} className="form-stack" onSubmit={importCsv}><Field label={t("CSV data")} hint={t("Required columns: name,source_url. Optional: organization,provider,contact_handle,notes,consent_status.")}><Textarea name="csv_text" rows={12} required placeholder={'name,source_url,organization\nAlex,https://simbi.com/alex,Community Lab'} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(null)}>{t("Cancel")}</Button><Button>{t("Validate and import")}</Button></div></PendingForm></Modal> : null}
  </PageFrame>
}

export function CampaignsPage({ member }: { member: Member; onMemberChange: (member: Member) => void }) {
  const { t, formatMessage } = useI18n()
  const canEdit = ['owner', 'admin', 'editor'].includes(member.role)
  const [modal, setModal] = useState(false)
  const action = usePendingMutation()
  const [message, setMessage] = useState('')
  const { page, load, loading, error } = usePage<Campaign>('/campaigns?order=newest')

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit || !action.begin(event.currentTarget)) return; setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await post('/campaigns', { ...values, daily_limit: Number(values.daily_limit), cooldown_minutes: Number(values.cooldown_minutes) }); setModal(false); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not create campaign') }
    finally { action.end() }
  }

  async function changeStatus(id: number, status: Campaign['status']) {
    if (!canEdit || !action.begin()) return
    setMessage('')
    try { await patch(`/campaigns/${id}/status`, { status }); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Status could not be changed') }
    finally { action.end() }
  }

  return <PageFrame title={t("Campaigns")} detail={t("Each campaign records its purpose, lawful basis, manual handoff limit and prospect cooldown.")} actions={canEdit ? <Button onClick={() => { setMessage(''); setModal(true) }}><Plus size={17} />{t("New campaign")}</Button> : null}>
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    {!member.compliance_ack_at ? <Notice tone="warning">{t("Campaigns remain in draft until an owner or admin completes the compliance review in Settings.")}</Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}
    <Panel><DataState label={t("campaigns")} loading={loading} error={error} hasData={Boolean(page?.items.length)} retry={load}>{page?.items.length ? <div className="resource-list">{page.items.map((campaign) => <article className="resource-row" key={campaign.id}><div className="resource-main"><div><h3>{campaign.name}</h3><Status value={campaign.status} /></div><p>{campaign.description || campaign.purpose}</p><dl><div><dt>{t("Lawful basis")}</dt><dd>{campaign.lawful_basis}</dd></div><div><dt>{t("Daily handoffs")}</dt><dd>{campaign.daily_limit}</dd></div><div><dt>{t("Cooldown")}</dt><dd>{Math.round(campaign.cooldown_minutes / 60)} {' '}{t("hours")}</dd></div></dl></div>{canEdit ? <div className="row-actions">{campaign.status !== 'active' ? <Button variant="secondary" disabled={action.busy} onClick={() => changeStatus(campaign.id, 'active')}>{t("Activate")}</Button> : <Button variant="secondary" disabled={action.busy} onClick={() => changeStatus(campaign.id, 'paused')}>{t("Pause")}</Button>}<Button variant="quiet" disabled={action.busy} onClick={() => changeStatus(campaign.id, 'archived')}>{t("Archive")}</Button></div> : null}</article>)}</div> : <EmptyState title={t("No campaigns")} detail={t("Define why you are reaching out and which safeguards apply before adding drafts.")} action={canEdit ? <Button onClick={() => setModal(true)}><Plus size={17} />{t("Create campaign")}</Button> : null} />}</DataState></Panel>
    {canEdit && modal ? <Modal title={t("Create campaign")} closeDisabled={action.busy} onClose={() => { if (!action.pending()) setModal(false) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}<PendingForm busy={action.busy} className="form-grid" onSubmit={create}><Field label={t("Name")}><Input name="name" required minLength={2} maxLength={120} /></Field><Field label={t("Purpose")} hint={t("Describe the specific exchange or networking outcome.")}><Textarea name="purpose" required rows={3} minLength={10} maxLength={500} /></Field><Field label={t("Lawful basis / outreach context")}><Textarea name="lawful_basis" required rows={3} minLength={5} maxLength={300} placeholder={t("Contextual response to a member's published request; manually verified before contact.")} /></Field><Field label={t("Description")}><Textarea name="description" rows={3} maxLength={1000} /></Field><Field label={t("Daily handoff limit")}><Input name="daily_limit" type="number" min={1} max={50} defaultValue={10} required /></Field><Field label={t("Prospect cooldown (minutes)")}><Input name="cooldown_minutes" type="number" min={60} max={43200} defaultValue={1440} required /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(false)}>{t("Cancel")}</Button><Button>{t("Create draft campaign")}</Button></div></PendingForm></Modal> : null}
  </PageFrame>
}

export function TemplatesPage({ canEdit }: { canEdit: boolean }) {
  const { t, formatMessage } = useI18n()
  const [modal, setModal] = useState(false)
  const action = usePendingMutation()
  const [message, setMessage] = useState('')
  const { page, load, loading, error } = usePage<Template>('/templates?order=name')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit || !action.begin(event.currentTarget)) return; setMessage('')
    try { await post('/templates', Object.fromEntries(new FormData(event.currentTarget))); setModal(false); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not create template') }
    finally { action.end() }
  }
  return <PageFrame title={t("Templates")} detail={t("Reusable starting points stay deterministic. Every rendered message returns to the review queue.")} actions={canEdit ? <Button onClick={() => { setMessage(''); setModal(true) }}><FilePlus2 size={17} />{t("New template")}</Button> : null}>
    {message && !modal ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    <Panel><DataState label={t("templates")} loading={loading} error={error} hasData={Boolean(page?.items.length)} retry={load}>{page?.items.length ? <div className="template-grid">{page.items.map((template) => <article className="template-item" key={template.id}><header><div><h3>{template.name}</h3><small>{template.provider} {' '}{t("· version")}{' '}{template.version}</small></div></header>{template.subject ? <strong>{template.subject}</strong> : null}<p>{template.body}</p></article>)}</div> : <EmptyState title={t("No templates")} detail={t("Create a thoughtful starting point using explicit placeholders. AI is not required.")} />}</DataState></Panel>
    {canEdit && modal ? <Modal title={t("Create template")} closeDisabled={action.busy} onClose={() => { if (!action.pending()) setModal(false) }}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : <Notice>{t("Allowed placeholders:")}{' '}{'{name}'}, {'{organization}'}, {'{campaign}'}, {'{notes}'}{t(". Unknown placeholders are rejected.")}</Notice>}<PendingForm busy={action.busy} className="form-stack" onSubmit={create}><Field label={t("Template name")}><Input name="name" required minLength={2} maxLength={120} /></Field><Field label={t("Provider")}><Input name="provider" defaultValue="simbi" required minLength={2} maxLength={40} /></Field><Field label={t("Subject (optional)")}><Input name="subject" maxLength={200} /></Field><Field label={t("Message body")}><Textarea name="body" rows={10} required minLength={20} maxLength={5000} defaultValue={'Hello {name},\n\nI saw your request and thought I may be able to help with {campaign}. {notes}\n\nIf this is not useful, no thanks is completely fine and I will not follow up.'} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(false)}>{t("Cancel")}</Button><Button>{t("Create template")}</Button></div></PendingForm></Modal> : null}
  </PageFrame>
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const { t } = useI18n()
  return <label className="search"><Search size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><button type="button" onClick={() => onChange('')} aria-label={t("Clear search")}><X size={16} /></button></label>
}

function PageFrame({ title, detail, actions, children }: { title: string; detail: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="page"><header className="page-hero"><div><h1>{title}</h1><p>{detail}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>{children}</div>
}
