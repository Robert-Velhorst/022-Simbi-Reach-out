import { useI18n } from '../i18n'
import { useState, type FormEvent } from 'react'
import { BellPlus, Check, ExternalLink, MessageSquarePlus, RefreshCw, ShieldCheck } from 'lucide-react'
import { ApiError, patch, post } from '../api'
import { Button, EmptyState, Field, Modal, Notice, Panel, Select, Textarea, Input, Status, TableRegion } from '../components/ui'
import type { AuditEvent, Draft, Reminder } from '../types'
import { usePage } from '../usePage'
import { PageNavigation } from '../components/PageNavigation'
import { DataState } from '../components/DataState'
import { useResource } from '../useResource'
import { LocalDateTimeInput, localDateTimeISO } from '../components/LocalDateTimeInput'

type Reply = { id: number; draft_id: number; prospect_name: string; campaign_name: string; body: string; received_at: string; direction: string }

export function RepliesPage({ canEdit }: { canEdit: boolean }) {
  const { t, formatMessage, formatDate, formatCode } = useI18n()
  const { page, load, loading, error } = usePage<Reply>('/replies')
  const items = page?.items ?? []
  const draftPage = usePage<Draft>('/drafts')
  const drafts = (draftPage.page?.items ?? []).filter((draft) => ['sent', 'ambiguous', 'handoff_created'].includes(draft.state))
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit) return; setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try { await post('/replies', { draft_id: Number(values.draft_id), body: values.body }); setOpen(false); await Promise.all([load(), draftPage.load(0)]) }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Reply could not be recorded') }
  }
  return <OperationPage title={t("Replies")} detail={t("Record replies manually after checking the provider. A reply closes open follow-up reminders for that draft.")} action={canEdit ? <Button onClick={() => { setMessage(''); setOpen(true); void draftPage.load(0) }}><MessageSquarePlus size={17} />{t("Record reply")}</Button> : null}>
    <PageNavigation page={page} loading={loading} load={load} />
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    {message && !open ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}{draftPage.error ? <Notice tone="danger">{formatMessage(draftPage.error)}</Notice> : null}<Panel><DataState label={t("replies")} loading={loading} error={error} hasData={Boolean(items.length)} retry={load}>{items.length ? <div className="conversation-list">{items.map((reply) => <article key={reply.id}><header><div><strong>{reply.prospect_name}</strong><small>{reply.campaign_name}</small></div><time>{formatDate(reply.received_at)}</time></header><p>{reply.body}</p></article>)}</div> : <EmptyState title={t("No replies recorded")} detail={t("When someone responds, record the message or a concise summary here.")} />}</DataState></Panel>
    {canEdit && open ? <Modal title={t("Record provider reply")} onClose={() => setOpen(false)}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : <Notice>{t("Only record information needed for the outreach workflow. Avoid copying unrelated sensitive content.")}</Notice>}{draftPage.error ? <Notice tone="danger">{formatMessage(draftPage.error)}<Button variant="quiet" onClick={() => void draftPage.load()}>{t("Retry conversations")}</Button></Notice> : null}<form className="form-stack" onSubmit={create}><PageNavigation page={draftPage.page} loading={draftPage.loading} load={draftPage.load} /><Field label={t("Conversation")}><Select key={draftPage.page?.offset} name="draft_id" disabled={draftPage.loading || Boolean(draftPage.error)} required defaultValue=""><option value="" disabled>{t("Select conversation")}</option>{drafts.map((draft) => <option value={draft.id} key={draft.id}>{draft.prospect_name} — {draft.campaign_name} ({formatCode(draft.state)})</option>)}</Select></Field><Field label={t("Reply or concise summary")}><Textarea name="body" required rows={8} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>{t("Cancel")}</Button><Button disabled={draftPage.loading || Boolean(draftPage.error)}>{t("Record reply")}</Button></div></form></Modal> : null}
  </OperationPage>
}

export function RemindersPage({ canEdit }: { canEdit: boolean }) {
  const { t, formatMessage, formatDate } = useI18n()
  const { page, load, loading, error } = usePage<Reminder>('/reminders?status=open')
  const items = page?.items ?? []
  const draftPage = usePage<Draft>('/drafts')
  const drafts = draftPage.page?.items ?? []
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit) return; setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const due = localDateTimeISO(String(values.due_at))
    if (!due) { setMessage('Enter a valid local date and time using YYYY-MM-DDTHH:mm.'); (event.currentTarget.elements.namedItem('due_at') as HTMLInputElement | null)?.focus(); return }
    try { await post('/reminders', { draft_id: Number(values.draft_id), title: values.title, due_at: due }); setOpen(false); await Promise.all([load(), draftPage.load(0)]) }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Reminder could not be created') }
  }
  async function complete(id: number) {
    if (!canEdit) return
    setMessage('')
    try { await patch(`/reminders/${id}`, { status: 'done' }); await load() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Reminder could not be completed') }
  }
  return <OperationPage title={t("Reminders")} detail={t("Use reminders for decisions and follow-up review, never as an automatic send schedule.")} action={canEdit ? <Button onClick={() => { setMessage(''); setOpen(true); void draftPage.load(0) }}><BellPlus size={17} />{t("New reminder")}</Button> : null}>
    <PageNavigation page={page} loading={loading} load={load} />
    {!canEdit ? <Notice>{t("Your viewer role has read-only access. Ask an owner, admin or editor to make changes.")}</Notice> : null}
    {message && !open ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}{draftPage.error ? <Notice tone="danger">{formatMessage(draftPage.error)}</Notice> : null}<Panel><DataState label={t("reminders")} loading={loading} error={error} hasData={Boolean(items.length)} retry={load}>{items.length ? <div className="task-list">{items.map((item) => <article key={item.id}><div><strong>{item.title}</strong><span>{item.prospect_name ?? t("General")} · {item.campaign_name ?? t("No campaign")}</span><time>{formatDate(item.due_at)}</time></div>{canEdit ? <Button variant="secondary" onClick={() => complete(item.id)}><Check size={16} />{t("Done")}</Button> : null}</article>)}</div> : <EmptyState title={t("No open reminders")} detail={t("The local worker adds a review reminder after seven days without a recorded reply.")} />}</DataState></Panel>
    {canEdit && open ? <Modal title={t("Create reminder")} onClose={() => setOpen(false)}>{message ? <Notice tone="danger">{formatMessage(message)}</Notice> : null}{draftPage.error ? <Notice tone="danger">{formatMessage(draftPage.error)}<Button variant="quiet" onClick={() => void draftPage.load()}>{t("Retry conversations")}</Button></Notice> : null}<form className="form-stack" onSubmit={create}><PageNavigation page={draftPage.page} loading={draftPage.loading} load={draftPage.load} /><Field label={t("Conversation")}><Select key={draftPage.page?.offset} name="draft_id" disabled={draftPage.loading || Boolean(draftPage.error)} required defaultValue=""><option value="" disabled>{t("Select draft")}</option>{drafts.map((draft) => <option value={draft.id} key={draft.id}>{draft.prospect_name} — {draft.campaign_name}</option>)}</Select></Field><Field label={t("Reminder")}><Input name="title" required /></Field><LocalDateTimeInput name="due_at" /><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>{t("Cancel")}</Button><Button disabled={draftPage.loading || Boolean(draftPage.error)}>{t("Create reminder")}</Button></div></form></Modal> : null}
  </OperationPage>
}

type Report = { funnel: Record<string, number | null>; campaigns: Array<{ id: number; name: string; status: string; drafts: number; sent: number; replied: number; average_quality: number | null }>; generated_at: string; local_only: boolean }

export function ReportsPage() {
  const { t, formatCode } = useI18n()
  const { data: report, error, loading, load } = useResource<Report>('/reports/summary')
  const funnel = report?.funnel ?? {}
  return <OperationPage title={t("Reports")} detail={t("Local operational reporting focuses on workflow health, review quality and outcomes—not vanity metrics.")} action={<Button variant="secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={17} />{t("Refresh")}</Button>}>
    <DataState label={t("reports")} loading={loading} error={error} hasData={Boolean(report)} retry={load}><div className="metric-rail">{['total', 'needs_review', 'approved', 'prepared', 'sent', 'replied', 'suppressed'].map((key) => <div key={key}><span>{formatCode(key)}</span><strong>{funnel[key] ?? '—'}</strong></div>)}</div>
    <Panel title={t("Campaign quality and outcomes")}>{report?.campaigns.length ? <TableRegion label={t("Campaign quality and outcomes")}><table><thead><tr><th>{t("Campaign")}</th><th>{t("Status")}</th><th>{t("Drafts")}</th><th>{t("Sent manually")}</th><th>{t("Replies")}</th><th>{t("Avg. quality")}</th></tr></thead><tbody>{report.campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong></td><td><Status value={campaign.status} /></td><td>{campaign.drafts}</td><td>{campaign.sent ?? 0}</td><td>{campaign.replied ?? 0}</td><td>{campaign.average_quality ?? '—'}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title={t("No report data")} detail={t("Campaign results appear after drafts enter the workflow.")} />}</Panel></DataState>
  </OperationPage>
}

export function AuditPage() {
  const { t, formatDate, formatCode } = useI18n()
  const { page, load, loading, error } = usePage<AuditEvent>('/audit')
  const items = page?.items ?? []
  return <OperationPage title={t("Audit log")} detail={t("Operational events preserve who changed local state and when. New event details are minimized; the owner can explicitly remove known duplicate text from old entries without deleting events.")}>
    <PageNavigation page={page} loading={loading} load={load} />
    <Panel><DataState label={t("audit events")} loading={loading} error={error} hasData={Boolean(items.length)} retry={load}>{items.length ? <TableRegion label={t("Audit log")}><table><thead><tr><th>{t("Time")}</th><th>{t("Actor")}</th><th>{t("Event")}</th><th>{t("Entity")}</th></tr></thead><tbody>{items.map((event) => <tr key={event.id}><td>{formatDate(event.created_at)}</td><td>{event.display_name ?? t("Local worker")}</td><td><strong>{formatCode(event.event_type, '.')}</strong></td><td>{formatCode(event.entity_type)} {event.entity_id}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title={t("No events yet")} detail={t("Material changes will appear here automatically.")} />}</DataState></Panel>
  </OperationPage>
}

export function HelpPage() {
  const { t } = useI18n()
  return <OperationPage title={t("Operator guide")} detail={t("A short, practical path from first setup to a safe manual provider handoff.")}>
    <div className="settings-grid">
      <Panel title={t("Critical path")}>
        <ol className="guide-list">
          <li>{t("Review the current provider rules and record the acknowledgement in Settings.")}</li>
          <li>{t("Create a campaign with a specific purpose, outreach context, daily limit and cooldown.")}</li>
          <li>{t("Add only manually supplied or otherwise authorized prospect records.")}</li>
          <li>{t("Create a deterministic template, prepare a draft and complete every human review check.")}</li>
          <li>{t("Prepare the handoff, copy the approved text, and decide whether to open the provider yourself.")}</li>
          <li>{t("Record exactly what happened. Never mark a message sent unless you verified it on the provider.")}</li>
        </ol>
      </Panel>
      <Panel title={t("What the app will never do")}>
        <Notice tone="success"><ShieldCheck size={19} /><div><strong>{t("Manual means manual")}</strong><p>{t("It does not scrape profiles, store provider credentials, log in, fill provider forms, send messages, or infer that a message was sent.")}</p></div></Notice>
        <p className="panel-intro">{t("Use the emergency safety stop in Settings if provider rules, consent, limits or an external outcome are uncertain.")}</p>
      </Panel>
      <Panel title={t("Reference documentation")}>
        <div className="button-stack">
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/OPERATOR_RUNBOOK.md" target="_blank" rel="noreferrer">{t("Operator runbook")}{' '}<ExternalLink size={16} /></a>
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/PROVIDER_COMPLIANCE.md" target="_blank" rel="noreferrer">{t("Provider compliance")}{' '}<ExternalLink size={16} /></a>
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">{t("Security model")}{' '}<ExternalLink size={16} /></a>
        </div>
      </Panel>
    </div>
  </OperationPage>
}

function OperationPage({ title, detail, action, children }: { title: string; detail: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="page"><header className="page-hero"><div><h1>{title}</h1><p>{detail}</p></div>{action}</header>{children}</div>
}
