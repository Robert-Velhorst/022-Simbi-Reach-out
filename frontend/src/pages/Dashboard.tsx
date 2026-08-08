import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, CircleAlert, Info, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { EmptyState, Panel, Status, formatDate } from '../components/ui'
import type { AuditEvent, Campaign, Member, Reminder } from '../types'

type QueueItem = { id: number; state: string; quality_score: number; safety_flags: string[]; prospect_name: string; campaign_name: string; updated_at: string }
type Overview = {
  counts: { reviews: number; due: number; replies: number; prospects: number }
  queue: QueueItem[]
  campaigns: Campaign[]
  reminders: Reminder[]
  events: AuditEvent[]
  safety: { local_only: boolean; assisted_send_only: boolean; compliance_acknowledged: boolean; paused: boolean; demo_mode: boolean }
}

export default function Dashboard({ member }: { member: Member }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Overview>('/overview').then(setData).catch((cause) => setError(cause.message)) }, [])
  const firstName = member.display_name.split(' ')[0]

  return <div className="dashboard-page">
    <header className="page-hero dashboard-hero">
      <div><h1>Good morning, {firstName}</h1><p>{data ? `You have ${data.counts.reviews} drafts to review and ${data.counts.due} reminders due.` : 'Loading the work that needs your attention…'}</p></div>
      <Link className="button button-primary" to="/review">Review {data?.counts.reviews ?? 0} drafts <ArrowRight size={17} /></Link>
    </header>
    {error ? <div className="notice notice-danger"><CircleAlert size={18} />{error}</div> : null}
    <section className="safety-strip" aria-label="Safety and compliance status">
      <div className="safety-heading"><ShieldCheck /><span>Safety & compliance</span></div>
      <SafetyItem label="Local only" detail="No cloud sync" ready />
      <SafetyItem label="Data integrity" detail="SQLite + backups" ready />
      <SafetyItem label="PII protection" detail="On-device only" ready />
      <SafetyItem label="Provider guidance" detail="Assisted-send only" ready />
      <SafetyItem label="Policy review" detail={member.compliance_ack_at ? 'Acknowledged' : 'Required'} ready={Boolean(member.compliance_ack_at)} />
      <Link to="/settings">Review controls <ArrowRight size={15} /></Link>
    </section>
    <div className="dashboard-grid">
      <Panel className="queue-panel" title="Work queue (exception first)" action={<Link to="/review">Open full queue <ArrowRight size={15} /></Link>}>
        {data?.queue.length ? <div className="table-wrap"><table><thead><tr><th>Priority</th><th>Item</th><th>Campaign</th><th>Issue</th><th>Action</th></tr></thead><tbody>
          {data.queue.map((item) => <tr key={item.id}><td>{item.state === 'ambiguous' ? <CircleAlert className="danger-icon" size={18} /> : <Info className="warning-icon" size={18} />}</td><td><strong>{item.prospect_name}</strong><small>Quality {item.quality_score}/100</small></td><td>{item.campaign_name}</td><td>{item.state === 'ambiguous' ? 'Outcome needs resolution' : item.safety_flags[0]?.replaceAll('_', ' ') ?? 'Human review required'}</td><td><Link className="table-action" to="/review">Review</Link></td></tr>)}
        </tbody></table></div> : <EmptyState title="Your queue is clear" detail="Create a campaign, add a prospect and template, then prepare a draft." action={<Link className="text-link" to="/campaigns">Start a campaign <ArrowRight size={15} /></Link>} />}
      </Panel>
      <Panel className="campaign-panel" title="Campaign progress" action={<Link to="/campaigns">View all <ArrowRight size={15} /></Link>}>
        {data?.campaigns.length ? <div className="campaign-list">{data.campaigns.map((campaign) => {
          const total = campaign.total ?? 0; const reviewed = campaign.reviewed ?? 0; const progress = total ? Math.round(reviewed / total * 100) : 0
          return <div className="campaign-row" key={campaign.id}><div><strong>{campaign.name}</strong><Status value={campaign.status} /></div><div className="progress"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>
        })}</div> : <EmptyState title="No campaigns yet" detail="Campaigns hold the purpose, lawful basis and safe outreach limits." />}
      </Panel>
      <Panel title="Due reminders" action={<Link to="/reminders">View all <ArrowRight size={15} /></Link>}>
        {data?.reminders.length ? <ul className="plain-list">{data.reminders.map((reminder) => <li key={reminder.id}><div><strong>{reminder.title}</strong><small>{reminder.prospect_name ?? 'General'} · {reminder.campaign_name ?? 'No campaign'}</small></div><time>{formatDate(reminder.due_at)}</time></li>)}</ul> : <EmptyState title="Nothing due" detail="Follow-up decisions created by you or the local worker appear here." />}
      </Panel>
      <Panel title="Audit trail (latest)" action={<Link to="/audit">View full log <ArrowRight size={15} /></Link>}>
        {data?.events.length ? <ul className="plain-list audit-preview">{data.events.map((event) => <li key={event.id}><div><strong>{event.event_type.replaceAll('.', ' ')}</strong><small>{event.display_name ?? 'System'} · {event.entity_type} {event.entity_id}</small></div><time>{formatDate(event.created_at)}</time></li>)}</ul> : <EmptyState title="No actions recorded" detail="Every material local action will be listed here." />}
      </Panel>
    </div>
    <footer className="assisted-note"><Info size={17} />Simbi Reach-Out does not send messages for you. Review content, then copy and open your provider to send manually.</footer>
  </div>
}

function SafetyItem({ label, detail, ready }: { label: string; detail: string; ready: boolean }) {
  return <div className="safety-item">{ready ? <CheckCircle2 size={19} /> : <CircleAlert className="warning-icon" size={19} />}<div><strong>{label}</strong><small>{detail}</small></div></div>
}
