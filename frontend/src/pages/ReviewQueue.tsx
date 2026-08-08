import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, Clipboard, FilePlus2, ShieldAlert, Sparkles } from 'lucide-react'
import { api, ApiError, patch, post } from '../api'
import { Button, EmptyState, Field, Input, Modal, Notice, Panel, Select, Status, Textarea, formatDate } from '../components/ui'
import type { Campaign, Draft, Member, Page, Prospect, Template } from '../types'

type Handoff = { id: number; draft_id: number; provider_url: string; subject: string; body: string; status: string; instruction: string }
type ReviewData = { drafts: Draft[]; campaigns: Campaign[]; prospects: Prospect[]; templates: Template[] }
const checks = [
  ['source_authorized', 'I verified the source and may use this record.'],
  ['message_personalized', 'The message is specific, accurate and not deceptive.'],
  ['policy_reviewed', 'The message complies with the provider policy and applicable rules.'],
  ['manual_send_understood', 'I understand the app will not send this message.'],
] as const

export default function ReviewQueue({ member }: { member: Member; onMemberChange: (member: Member) => void }) {
  const [data, setData] = useState<ReviewData>({ drafts: [], campaigns: [], prospects: [], templates: [] })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [drafts, campaigns, prospects, templates] = await Promise.all([
      api<{ items: Draft[] }>('/drafts'), api<Page<Campaign>>('/campaigns?order=name'),
      api<Page<Prospect>>('/prospects?order=name'), api<Page<Template>>('/templates?order=name'),
    ])
    setData({ drafts: drafts.items, campaigns: campaigns.items, prospects: prospects.items, templates: templates.items })
    setSelectedId((current) => current && drafts.items.some((item) => item.id === current) ? current : drafts.items[0]?.id ?? null)
  }, [])
  useEffect(() => { void load() }, [load])
  const selected = data.drafts.find((draft) => draft.id === selectedId) ?? null

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); setBusy(true)
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await post('/drafts', { campaign_id: Number(values.campaign_id), prospect_id: Number(values.prospect_id), template_id: Number(values.template_id) })
      setCreateOpen(false); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Draft could not be created') }
    finally { setBusy(false) }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setMessage(''); setBusy(true)
    try { await patch(`/drafts/${selected.id}`, Object.fromEntries(new FormData(event.currentTarget))); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Draft could not be saved') }
    finally { setBusy(false) }
  }

  async function review(decision: 'approve' | 'decline') {
    if (!selected) return; setMessage(''); setBusy(true)
    try { await post(`/drafts/${selected.id}/review`, { decision, acknowledged_checks: checked }); setChecked([]); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Review could not be recorded') }
    finally { setBusy(false) }
  }

  async function prepareHandoff() {
    if (!selected) return; setMessage(''); setBusy(true)
    try {
      const result = await post<Handoff>(`/drafts/${selected.id}/handoff`, {}, { 'Idempotency-Key': crypto.randomUUID() })
      setHandoff(result); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Handoff could not be prepared') }
    finally { setBusy(false) }
  }

  async function resolveHandoff() {
    if (!selected) return
    setMessage('')
    try {
      const result = await api<{ items: Handoff[] }>(`/handoffs?draft_id=${selected.id}&limit=1`)
      if (!result.items.length) {
        setMessage('No handoff record was found. Check the audit log before changing this draft.')
        return
      }
      setHandoff(result.items[0])
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Handoff could not be loaded')
    }
  }

  async function outcome(value: 'sent' | 'ambiguous' | 'cancelled') {
    if (!handoff) return
    try { await post(`/handoffs/${handoff.id}/outcome`, { outcome: value }); setHandoff(null); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Outcome could not be recorded') }
  }

  return <div className="page review-page">
    <header className="page-hero"><div><h1>Review queue</h1><p>Every message stays here until a human reviews its source, wording, policy context and intended manual action.</p></div><Button onClick={() => { setMessage(''); setCreateOpen(true) }}><FilePlus2 size={17} />Prepare draft</Button></header>
    {!member.compliance_ack_at ? <Notice tone="warning">Approval is locked until an owner or admin completes the compliance review in Settings.</Notice> : null}
    {message ? <Notice tone="danger">{message}</Notice> : null}
    {data.drafts.length ? <div className="review-layout">
      <Panel className="review-list" title={`${data.drafts.length} draft${data.drafts.length === 1 ? '' : 's'}`}>
        {data.drafts.map((draft) => <button key={draft.id} className={`review-item ${draft.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(draft.id); setChecked([]); setMessage('') }}><div><strong>{draft.prospect_name}</strong><Status value={draft.state} /></div><span>{draft.campaign_name}</span><small>Quality {draft.quality_score}/100 · {formatDate(draft.updated_at)}</small></button>)}
      </Panel>
      {selected ? <Panel className="review-detail" title={selected.prospect_name} action={<Status value={selected.state} />}>
        <div className="review-context"><div><span>Campaign</span><strong>{selected.campaign_name}</strong></div><div><span>Source context</span><a href={selected.source_url} target="_blank" rel="noreferrer">Open reviewed source <ArrowUpRight size={14} /></a></div><div><span>Consent</span><Status value={selected.consent_status} /></div><div><span>Quality</span><strong>{selected.quality_score}/100</strong></div></div>
        {selected.safety_flags.length ? <Notice tone="warning"><strong>Review signals:</strong> {selected.safety_flags.map((flag) => flag.replaceAll('_', ' ')).join(', ')}. These are prompts for judgment, not automatic rejection.</Notice> : <Notice tone="success">The deterministic quality checks found no warnings. Human review is still required.</Notice>}
        <form className="form-stack draft-editor" onSubmit={saveDraft}>
          <Field label="Subject"><Input name="subject" defaultValue={selected.subject} disabled={!['needs_review', 'approved'].includes(selected.state)} /></Field>
          <Field label="Message"><Textarea name="body" rows={12} defaultValue={selected.body} disabled={!['needs_review', 'approved'].includes(selected.state)} required /></Field>
          {['needs_review', 'approved'].includes(selected.state) ? <div className="editor-actions"><Button variant="secondary" disabled={busy}>Save and return to review</Button></div> : null}
        </form>
        {selected.state === 'needs_review' ? <section className="approval-box"><h3><ShieldAlert size={19} />Pre-action safety review</h3>{checks.map(([value, label]) => <label className="check-row" key={value}><input type="checkbox" checked={checked.includes(value)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} /><span>{label}</span></label>)}<div className="approval-actions"><Button variant="quiet" onClick={() => review('decline')} disabled={busy}>Decline</Button><Button onClick={() => review('approve')} disabled={busy || checked.length !== checks.length}><Check size={17} />Approve for handoff</Button></div></section> : null}
        {selected.state === 'approved' ? <section className="approval-box ready"><h3><Check size={19} />Approved for assisted handoff</h3><p>The next step prepares a copyable message and provider link. It will not log in, fill a form or send anything.</p><Button onClick={prepareHandoff} disabled={busy || member.demo_mode}><Clipboard size={17} />Copy and open provider</Button>{member.demo_mode ? <small>External handoffs are blocked in demo mode.</small> : null}</section> : null}
        {selected.state === 'ambiguous' ? <section className="approval-box"><Notice tone="danger">The external outcome is ambiguous. Do not retry blindly. Verify the provider conversation manually, then record the result.</Notice><Button variant="secondary" onClick={resolveHandoff}>Resolve latest handoff</Button></section> : null}
      </Panel> : null}
    </div> : <Panel><EmptyState title="No drafts to review" detail="Prepare a draft after you have a campaign, an authorized prospect record and a reusable template." action={<Button onClick={() => setCreateOpen(true)}><Sparkles size={17} />Prepare first draft</Button>} /></Panel>}
    {createOpen ? <Modal title="Prepare a deterministic draft" onClose={() => setCreateOpen(false)}>{message ? <Notice tone="danger">{message}</Notice> : <Notice>Template placeholders are rendered locally. The result always starts in the review queue.</Notice>}<form className="form-stack" onSubmit={createDraft}><Field label="Campaign"><Select name="campaign_id" required defaultValue=""><option value="" disabled>Select campaign</option>{data.campaigns.filter((campaign) => campaign.status !== 'archived').map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name} ({campaign.status})</option>)}</Select></Field><Field label="Prospect"><Select name="prospect_id" required defaultValue=""><option value="" disabled>Select prospect</option>{data.prospects.filter((prospect) => !['opted_out', 'blocked'].includes(prospect.consent_status)).map((prospect) => <option value={prospect.id} key={prospect.id}>{prospect.name}{prospect.organization ? ` — ${prospect.organization}` : ''}</option>)}</Select></Field><Field label="Template"><Select name="template_id" required defaultValue=""><option value="" disabled>Select template</option>{data.templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</Select></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy}>Prepare draft</Button></div></form></Modal> : null}
    {handoff ? <Modal title="Manual provider handoff" onClose={() => setHandoff(null)}><Notice tone="warning">Nothing has been sent. Copy the approved text, open the provider, send it yourself if still appropriate, then record exactly what happened.</Notice><Field label="Approved message"><Textarea readOnly rows={12} value={`${handoff.subject ? `${handoff.subject}\n\n` : ''}${handoff.body}`} /></Field><div className="handoff-actions"><Button variant="secondary" onClick={() => navigator.clipboard.writeText(`${handoff.subject ? `${handoff.subject}\n\n` : ''}${handoff.body}`)}><Clipboard size={17} />Copy message</Button><a className="button button-primary" href={handoff.provider_url} target="_blank" rel="noreferrer">Open provider <ArrowUpRight size={17} /></a></div><div className="outcome-box"><strong>After checking the provider, record the outcome:</strong><div><Button variant="secondary" onClick={() => outcome('cancelled')}>Not sent</Button><Button variant="danger" onClick={() => outcome('ambiguous')}>Unsure — needs verification</Button><Button onClick={() => outcome('sent')}>Sent manually</Button></div></div></Modal> : null}
  </div>
}
