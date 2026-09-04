import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BellPlus, Check, ExternalLink, MessageSquarePlus, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, ApiError, patch, post } from '../api'
import { Button, EmptyState, Field, Modal, Notice, Panel, Select, Textarea, Input, Status, formatDate } from '../components/ui'
import type { AuditEvent, Draft, Reminder } from '../types'
import { usePage } from '../usePage'
import { PageNavigation } from '../components/PageNavigation'

type Reply = { id: number; draft_id: number; prospect_name: string; campaign_name: string; body: string; received_at: string; direction: string }

export function RepliesPage() {
  const { page, load, loading, error } = usePage<Reply>('/replies')
  const items = page?.items ?? []
  const draftPage = usePage<Draft>('/drafts')
  const drafts = (draftPage.page?.items ?? []).filter((draft) => ['sent', 'ambiguous', 'handoff_created'].includes(draft.state))
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try { await post('/replies', { draft_id: Number(values.draft_id), body: values.body }); setOpen(false); await Promise.all([load(), draftPage.load(0)]) }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Reply could not be recorded') }
  }
  return <OperationPage title="Replies" detail="Record replies manually after checking the provider. A reply closes open follow-up reminders for that draft." action={<Button onClick={() => { setMessage(''); setOpen(true); void draftPage.load(0) }}><MessageSquarePlus size={17} />Record reply</Button>}>
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {message && !open ? <Notice tone="danger">{message}</Notice> : null}{draftPage.error ? <Notice tone="danger">{draftPage.error}</Notice> : null}<Panel>{items.length ? <div className="conversation-list">{items.map((reply) => <article key={reply.id}><header><div><strong>{reply.prospect_name}</strong><small>{reply.campaign_name}</small></div><time>{formatDate(reply.received_at)}</time></header><p>{reply.body}</p></article>)}</div> : <EmptyState title="No replies recorded" detail="When someone responds, record the message or a concise summary here." />}</Panel>
    {open ? <Modal title="Record provider reply" onClose={() => setOpen(false)}>{message ? <Notice tone="danger">{message}</Notice> : <Notice>Only record information needed for the outreach workflow. Avoid copying unrelated sensitive content.</Notice>}{draftPage.error ? <Notice tone="danger">{draftPage.error}<Button variant="quiet" onClick={() => void draftPage.load()}>Retry conversations</Button></Notice> : null}<form className="form-stack" onSubmit={create}><PageNavigation page={draftPage.page} loading={draftPage.loading} load={draftPage.load} /><Field label="Conversation"><Select key={draftPage.page?.offset} name="draft_id" disabled={draftPage.loading || Boolean(draftPage.error)} required defaultValue=""><option value="" disabled>Select conversation</option>{drafts.map((draft) => <option value={draft.id} key={draft.id}>{draft.prospect_name} — {draft.campaign_name} ({draft.state})</option>)}</Select></Field><Field label="Reply or concise summary"><Textarea name="body" required rows={8} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={draftPage.loading || Boolean(draftPage.error)}>Record reply</Button></div></form></Modal> : null}
  </OperationPage>
}

export function RemindersPage() {
  const { page, load, loading, error } = usePage<Reminder>('/reminders?status=open')
  const items = page?.items ?? []
  const draftPage = usePage<Draft>('/drafts')
  const drafts = draftPage.page?.items ?? []
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try { await post('/reminders', { draft_id: Number(values.draft_id), title: values.title, due_at: new Date(String(values.due_at)).toISOString() }); setOpen(false); await Promise.all([load(), draftPage.load(0)]) }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Reminder could not be created') }
  }
  async function complete(id: number) {
    setMessage('')
    try { await patch(`/reminders/${id}`, { status: 'done' }); await load() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Reminder could not be completed') }
  }
  return <OperationPage title="Reminders" detail="Use reminders for decisions and follow-up review, never as an automatic send schedule." action={<Button onClick={() => { setMessage(''); setOpen(true); void draftPage.load(0) }}><BellPlus size={17} />New reminder</Button>}>
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {message && !open ? <Notice tone="danger">{message}</Notice> : null}{draftPage.error ? <Notice tone="danger">{draftPage.error}</Notice> : null}<Panel>{items.length ? <div className="task-list">{items.map((item) => <article key={item.id}><div><strong>{item.title}</strong><span>{item.prospect_name ?? 'General'} · {item.campaign_name ?? 'No campaign'}</span><time>{formatDate(item.due_at)}</time></div><Button variant="secondary" onClick={() => complete(item.id)}><Check size={16} />Done</Button></article>)}</div> : <EmptyState title="No open reminders" detail="The local worker adds a review reminder after seven days without a recorded reply." />}</Panel>
    {open ? <Modal title="Create reminder" onClose={() => setOpen(false)}>{message ? <Notice tone="danger">{message}</Notice> : null}{draftPage.error ? <Notice tone="danger">{draftPage.error}<Button variant="quiet" onClick={() => void draftPage.load()}>Retry conversations</Button></Notice> : null}<form className="form-stack" onSubmit={create}><PageNavigation page={draftPage.page} loading={draftPage.loading} load={draftPage.load} /><Field label="Conversation"><Select key={draftPage.page?.offset} name="draft_id" disabled={draftPage.loading || Boolean(draftPage.error)} required defaultValue=""><option value="" disabled>Select draft</option>{drafts.map((draft) => <option value={draft.id} key={draft.id}>{draft.prospect_name} — {draft.campaign_name}</option>)}</Select></Field><Field label="Reminder"><Input name="title" required /></Field><Field label="Due"><Input name="due_at" type="datetime-local" required /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={draftPage.loading || Boolean(draftPage.error)}>Create reminder</Button></div></form></Modal> : null}
  </OperationPage>
}

type Report = { funnel: Record<string, number | null>; campaigns: Array<{ id: number; name: string; status: string; drafts: number; sent: number; replied: number; average_quality: number | null }>; generated_at: string; local_only: boolean }

export function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [message, setMessage] = useState('')
  const load = useCallback(async () => {
    setMessage('')
    try { setReport(await api<Report>('/reports/summary')) }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Report could not be loaded') }
  }, [])
  useEffect(() => { void load() }, [load])
  const funnel = report?.funnel ?? {}
  return <OperationPage title="Reports" detail="Local operational reporting focuses on workflow health, review quality and outcomes—not vanity metrics." action={<Button variant="secondary" onClick={load}><RefreshCw size={17} />Refresh</Button>}>
    <div className="metric-rail">{['total', 'needs_review', 'approved', 'prepared', 'sent', 'replied', 'suppressed'].map((key) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{funnel[key] ?? 0}</strong></div>)}</div>
    {message ? <Notice tone="danger">{message}</Notice> : null}
    <Panel title="Campaign quality and outcomes">{report?.campaigns.length ? <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Status</th><th>Drafts</th><th>Sent manually</th><th>Replies</th><th>Avg. quality</th></tr></thead><tbody>{report.campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong></td><td><Status value={campaign.status} /></td><td>{campaign.drafts}</td><td>{campaign.sent ?? 0}</td><td>{campaign.replied ?? 0}</td><td>{campaign.average_quality ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="No report data" detail="Campaign results appear after drafts enter the workflow." />}</Panel>
  </OperationPage>
}

export function AuditPage() {
  const { page, load, loading, error } = usePage<AuditEvent>('/audit')
  const items = page?.items ?? []
  return <OperationPage title="Audit log" detail="Append-only operational events show who changed local state and when. Secrets and message bodies are intentionally excluded from event details.">
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    <Panel>{items.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Entity</th></tr></thead><tbody>{items.map((event) => <tr key={event.id}><td>{formatDate(event.created_at)}</td><td>{event.display_name ?? 'Local worker'}</td><td><strong>{event.event_type.replaceAll('.', ' ')}</strong></td><td>{event.entity_type} {event.entity_id}</td></tr>)}</tbody></table></div> : <EmptyState title="No events yet" detail="Material changes will appear here automatically." />}</Panel>
  </OperationPage>
}

export function HelpPage() {
  return <OperationPage title="Operator guide" detail="A short, practical path from first setup to a safe manual provider handoff.">
    <div className="settings-grid">
      <Panel title="Critical path">
        <ol className="guide-list">
          <li>Review the current provider rules and record the acknowledgement in Settings.</li>
          <li>Create a campaign with a specific purpose, outreach context, daily limit and cooldown.</li>
          <li>Add only manually supplied or otherwise authorized prospect records.</li>
          <li>Create a deterministic template, prepare a draft and complete every human review check.</li>
          <li>Prepare the handoff, copy the approved text, and decide whether to open the provider yourself.</li>
          <li>Record exactly what happened. Never mark a message sent unless you verified it on the provider.</li>
        </ol>
      </Panel>
      <Panel title="What the app will never do">
        <Notice tone="success"><ShieldCheck size={19} /><div><strong>Manual means manual</strong><p>It does not scrape profiles, store provider credentials, log in, fill provider forms, send messages, or infer that a message was sent.</p></div></Notice>
        <p className="panel-intro">Use the emergency safety stop in Settings if provider rules, consent, limits or an external outcome are uncertain.</p>
      </Panel>
      <Panel title="Reference documentation">
        <div className="button-stack">
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/OPERATOR_RUNBOOK.md" target="_blank" rel="noreferrer">Operator runbook <ExternalLink size={16} /></a>
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/PROVIDER_COMPLIANCE.md" target="_blank" rel="noreferrer">Provider compliance <ExternalLink size={16} /></a>
          <a className="button button-secondary" href="https://github.com/Robert-Velhorst/022-Simbi-Reach-out/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">Security model <ExternalLink size={16} /></a>
        </div>
      </Panel>
    </div>
  </OperationPage>
}

function OperationPage({ title, detail, action, children }: { title: string; detail: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="page"><header className="page-hero"><div><h1>{title}</h1><p>{detail}</p></div>{action}</header>{children}</div>
}
