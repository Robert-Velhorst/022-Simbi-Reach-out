import { useState, type FormEvent } from 'react'
import { ArrowUpRight, FilePlus2, Plus, Search, Upload, X } from 'lucide-react'
import { ApiError, patch, post } from '../api'
import { usePage } from '../usePage'
import { PageNavigation } from '../components/PageNavigation'
import { Button, EmptyState, Field, Input, Modal, Notice, Panel, Select, Status, Textarea } from '../components/ui'
import type { Campaign, Member, Prospect, Template } from '../types'

export function ProspectsPage() {
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'create' | 'import' | null>(null)
  const [message, setMessage] = useState('')
  const [stopTarget, setStopTarget] = useState<Prospect | null>(null)
  const [stopping, setStopping] = useState(false)
  const { page, load, loading, error } = usePage<Prospect>(`/prospects?search=${encodeURIComponent(search)}&order=name`)

  async function stopContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stopTarget || stopping) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (reason.length < 3 || reason.length > 500) { setMessage('Enter a reason between 3 and 500 characters.'); return }
    setMessage(''); setStopping(true)
    try {
      await post('/suppressions', { prospect_id: stopTarget.id, reason })
      setStopTarget(null); await load()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Contact could not be stopped') }
    finally { setStopping(false) }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      await post('/prospects', Object.fromEntries(form)); setModal(null); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not add prospect') }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const form = new FormData(event.currentTarget)
    const csvText = String(form.get('csv_text') ?? '')
    try {
      const preview = await post<{ valid: number; errors: { line: number; message: string }[] }>('/prospects/import', { csv_text: csvText, commit: false })
      if (preview.errors.length) { setMessage(`${preview.errors.length} row(s) need attention. First error: line ${preview.errors[0].line} — ${preview.errors[0].message}`); return }
      await post('/prospects/import', { csv_text: csvText, commit: true }); setModal(null); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Import failed') }
  }

  return <PageFrame title="Prospects" detail="Only add people from a source you are authorized to use. This product does not scrape or harvest platform data." actions={<><Button variant="secondary" onClick={() => { setMessage(''); setModal('import') }}><Upload size={17} />Import CSV</Button><Button onClick={() => { setMessage(''); setModal('create') }}><Plus size={17} />Add prospect</Button></>}>
    <SearchBar value={search} onChange={setSearch} placeholder="Search name, organization or notes" />
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    {message && !modal ? <Notice tone="danger">{message}</Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {stopTarget ? <Modal title={`Stop contact: ${stopTarget.name}`} onClose={() => { if (!stopping) setStopTarget(null) }}>{message ? <Notice tone="danger">{message}</Notice> : null}<Notice tone="warning">This records an opt-out and blocks further outreach to this prospect. Existing records remain available for reference and audit.</Notice><form className="form-stack" onSubmit={stopContact}><Field label="Reason"><Textarea name="reason" required minLength={3} maxLength={500} rows={4} /></Field><div className="modal-actions"><Button type="button" variant="quiet" disabled={stopping} onClick={() => setStopTarget(null)}>Cancel</Button><Button variant="danger" disabled={stopping}>Confirm stop contact</Button></div></form></Modal> : null}
    <Panel>{page?.items.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Organization</th><th>Provider</th><th>Consent context</th><th>Source</th><th>Contact safety</th></tr></thead><tbody>
      {page.items.map((prospect) => <tr key={prospect.id}><td><strong>{prospect.name}</strong><small>{prospect.contact_handle || 'No handle stored'}</small></td><td>{prospect.organization || '—'}</td><td>{prospect.provider}</td><td><Status value={prospect.consent_status} /></td><td><a className="table-action" href={prospect.source_url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={14} /></a></td><td><Button variant="danger" disabled={stopping || ['opted_out', 'blocked'].includes(prospect.consent_status)} onClick={() => { setMessage(''); setStopTarget(prospect) }}>Stop contact</Button></td></tr>)}
    </tbody></table></div> : <EmptyState title="No prospects" detail="Add a prospect manually or import a reviewed CSV. Name and an HTTPS source URL are required." action={<Button onClick={() => setModal('create')}><Plus size={17} />Add the first prospect</Button>} />}</Panel>
    {modal === 'create' ? <Modal title="Add prospect" onClose={() => setModal(null)}>{message ? <Notice tone="danger">{message}</Notice> : null}<form className="form-grid" onSubmit={create}><Field label="Name"><Input name="name" required /></Field><Field label="Organization"><Input name="organization" /></Field><Field label="Provider"><Input name="provider" defaultValue="simbi" required /></Field><Field label="Source URL" hint="Must be an HTTPS page you are authorized to use."><Input name="source_url" type="url" required placeholder="https://simbi.com/..." /></Field><Field label="Contact handle"><Input name="contact_handle" /></Field><Field label="Consent context"><Select name="consent_status" defaultValue="unknown"><option value="unknown">Unknown — review required</option><option value="contextual">Contextual request</option><option value="consented">Explicit consent</option><option value="opted_out">Opted out</option><option value="blocked">Blocked</option></Select></Field><Field label="Notes"><Textarea name="notes" rows={4} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(null)}>Cancel</Button><Button>Add prospect</Button></div></form></Modal> : null}
    {modal === 'import' ? <Modal title="Import reviewed prospects" onClose={() => setModal(null)}>{message ? <Notice tone="danger">{message}</Notice> : <Notice>Preview validation runs before any record is written. Duplicate provider/source pairs are skipped.</Notice>}<form className="form-stack" onSubmit={importCsv}><Field label="CSV data" hint="Required columns: name,source_url. Optional: organization,provider,contact_handle,notes,consent_status."><Textarea name="csv_text" rows={12} required placeholder={'name,source_url,organization\nAlex,https://simbi.com/alex,Community Lab'} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(null)}>Cancel</Button><Button>Validate and import</Button></div></form></Modal> : null}
  </PageFrame>
}

export function CampaignsPage({ member }: { member: Member; onMemberChange: (member: Member) => void }) {
  const [modal, setModal] = useState(false)
  const [message, setMessage] = useState('')
  const { page, load, loading, error } = usePage<Campaign>('/campaigns?order=newest')

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await post('/campaigns', { ...values, daily_limit: Number(values.daily_limit), cooldown_minutes: Number(values.cooldown_minutes) }); setModal(false); await load()
    } catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not create campaign') }
  }

  async function changeStatus(id: number, status: Campaign['status']) {
    setMessage('')
    try { await patch(`/campaigns/${id}/status`, { status }); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Status could not be changed') }
  }

  return <PageFrame title="Campaigns" detail="Each campaign records its purpose, lawful basis, manual handoff limit and prospect cooldown." actions={<Button onClick={() => { setMessage(''); setModal(true) }}><Plus size={17} />New campaign</Button>}>
    {!member.compliance_ack_at ? <Notice tone="warning">Campaigns remain in draft until an owner or admin completes the compliance review in Settings.</Notice> : null}
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    {message ? <Notice tone="danger">{message}</Notice> : null}
    <Panel>{page?.items.length ? <div className="resource-list">{page.items.map((campaign) => <article className="resource-row" key={campaign.id}><div className="resource-main"><div><h3>{campaign.name}</h3><Status value={campaign.status} /></div><p>{campaign.description || campaign.purpose}</p><dl><div><dt>Lawful basis</dt><dd>{campaign.lawful_basis}</dd></div><div><dt>Daily handoffs</dt><dd>{campaign.daily_limit}</dd></div><div><dt>Cooldown</dt><dd>{Math.round(campaign.cooldown_minutes / 60)} hours</dd></div></dl></div><div className="row-actions">{campaign.status !== 'active' ? <Button variant="secondary" onClick={() => changeStatus(campaign.id, 'active')}>Activate</Button> : <Button variant="secondary" onClick={() => changeStatus(campaign.id, 'paused')}>Pause</Button>}<Button variant="quiet" onClick={() => changeStatus(campaign.id, 'archived')}>Archive</Button></div></article>)}</div> : <EmptyState title="No campaigns" detail="Define why you are reaching out and which safeguards apply before adding drafts." action={<Button onClick={() => setModal(true)}><Plus size={17} />Create campaign</Button>} />}</Panel>
    {modal ? <Modal title="Create campaign" onClose={() => setModal(false)}>{message ? <Notice tone="danger">{message}</Notice> : null}<form className="form-grid" onSubmit={create}><Field label="Name"><Input name="name" required /></Field><Field label="Purpose" hint="Describe the specific exchange or networking outcome."><Textarea name="purpose" required rows={3} /></Field><Field label="Lawful basis / outreach context"><Textarea name="lawful_basis" required rows={3} placeholder="Contextual response to a member's published request; manually verified before contact." /></Field><Field label="Description"><Textarea name="description" rows={3} /></Field><Field label="Daily handoff limit"><Input name="daily_limit" type="number" min={1} max={50} defaultValue={10} required /></Field><Field label="Prospect cooldown (minutes)"><Input name="cooldown_minutes" type="number" min={60} max={43200} defaultValue={1440} required /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(false)}>Cancel</Button><Button>Create draft campaign</Button></div></form></Modal> : null}
  </PageFrame>
}

export function TemplatesPage() {
  const [modal, setModal] = useState(false)
  const [message, setMessage] = useState('')
  const { page, load, loading, error } = usePage<Template>('/templates?order=name')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    try { await post('/templates', Object.fromEntries(new FormData(event.currentTarget))); setModal(false); await load() }
    catch (cause) { setMessage(cause instanceof ApiError ? cause.message : 'Could not create template') }
  }
  return <PageFrame title="Templates" detail="Reusable starting points stay deterministic. Every rendered message returns to the review queue." actions={<Button onClick={() => { setMessage(''); setModal(true) }}><FilePlus2 size={17} />New template</Button>}>
    {error ? <Notice tone="danger">{error}<Button variant="quiet" onClick={() => void load()}>Retry</Button></Notice> : null}
    {message && !modal ? <Notice tone="danger">{message}</Notice> : null}
    <PageNavigation page={page} loading={loading} load={load} />
    <Panel>{page?.items.length ? <div className="template-grid">{page.items.map((template) => <article className="template-item" key={template.id}><header><div><h3>{template.name}</h3><small>{template.provider} · version {template.version}</small></div></header>{template.subject ? <strong>{template.subject}</strong> : null}<p>{template.body}</p></article>)}</div> : <EmptyState title="No templates" detail="Create a thoughtful starting point using explicit placeholders. AI is not required." />}</Panel>
    {modal ? <Modal title="Create template" onClose={() => setModal(false)}>{message ? <Notice tone="danger">{message}</Notice> : <Notice>Allowed placeholders: {'{name}'}, {'{organization}'}, {'{campaign}'}, {'{notes}'}. Unknown placeholders are rejected.</Notice>}<form className="form-stack" onSubmit={create}><Field label="Template name"><Input name="name" required /></Field><Field label="Provider"><Input name="provider" defaultValue="simbi" required /></Field><Field label="Subject (optional)"><Input name="subject" /></Field><Field label="Message body"><Textarea name="body" rows={10} required defaultValue={'Hello {name},\n\nI saw your request and thought I may be able to help with {campaign}. {notes}\n\nIf this is not useful, no thanks is completely fine and I will not follow up.'} /></Field><div className="modal-actions"><Button type="button" variant="quiet" onClick={() => setModal(false)}>Cancel</Button><Button>Create template</Button></div></form></Modal> : null}
  </PageFrame>
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search"><Search size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={16} /></button></label>
}

function PageFrame({ title, detail, actions, children }: { title: string; detail: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="page"><header className="page-hero"><div><h1>{title}</h1><p>{detail}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>{children}</div>
}
