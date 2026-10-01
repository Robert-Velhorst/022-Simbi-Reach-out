import { useI18n } from '../i18n'
import { ArrowRight, CheckCircle2, CircleAlert, Info, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useResource } from '../useResource'
import { DataState } from '../components/DataState'
import { EmptyState, Panel, Status, TableRegion } from '../components/ui'
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
  const { t, formatDate, formatCode } = useI18n()
  const { data, error, loading, load } = useResource<Overview>('/overview')
  const firstName = member.display_name.split(' ')[0]

  return <div className="dashboard-page">
    <header className="page-hero dashboard-hero">
      <div><h1>{t("Good morning,")}{' '}{firstName}</h1><p>{data ? t('You have {reviews} drafts to review and {due} reminders due.', { reviews: data.counts.reviews, due: data.counts.due }) : loading ? t("Loading the work that needs your attention…") : t("Your work overview could not be loaded.")}</p></div>
      <Link className="button button-primary" to="/review">{data ? t('Review {count} drafts', { count: data.counts.reviews }) : t("Open review queue")} <ArrowRight size={17} /></Link>
    </header>
    <section className="safety-strip" aria-label={t("Safety and compliance status")}>
      <div className="safety-heading"><ShieldCheck /><span>{t("Safety & compliance")}</span></div>
      <SafetyItem label={t("Local only")} detail={t("No cloud sync")} ready />
      <SafetyItem label={t("Data integrity")} detail={t("SQLite + backups")} ready />
      <SafetyItem label={t("PII protection")} detail={t("On-device only")} ready />
      <SafetyItem label={t("Provider guidance")} detail={t("Assisted-send only")} ready />
      <SafetyItem label={t("Policy review")} detail={member.compliance_ack_at ? t("Acknowledged") : t("Required")} ready={Boolean(member.compliance_ack_at)} />
      <Link to="/settings">{t("Review controls")}{' '}<ArrowRight size={15} /></Link>
    </section>
    <DataState label={t("overview")} loading={loading} error={error} hasData={Boolean(data)} retry={load}><div className="dashboard-grid">
      <Panel className="queue-panel" title={t("Work queue (exception first)")} action={<Link to="/review">{t("Open full queue")}{' '}<ArrowRight size={15} /></Link>}>
        {data?.queue.length ? <TableRegion label={t("Work queue (exception first)")}><table><thead><tr><th>{t("Priority")}</th><th>{t("Item")}</th><th>{t("Campaign")}</th><th>{t("Issue")}</th><th>{t("Action")}</th></tr></thead><tbody>
          {data.queue.map((item) => <tr key={item.id}><td>{item.state === 'ambiguous' ? <CircleAlert className="danger-icon" size={18} /> : <Info className="warning-icon" size={18} />}</td><td><strong>{item.prospect_name}</strong><small>{t("Quality")}{' '}{item.quality_score}/100</small></td><td>{item.campaign_name}</td><td>{item.state === 'ambiguous' ? t("Outcome needs resolution") : (item.safety_flags[0] ? formatCode(item.safety_flags[0]) : undefined) ?? t("Human review required")}</td><td><Link className="table-action" to="/review">{t("Review")}</Link></td></tr>)}
        </tbody></table></TableRegion> : <EmptyState title={t("Your queue is clear")} detail={t("Create a campaign, add a prospect and template, then prepare a draft.")} action={<Link className="text-link" to="/campaigns">{t("Start a campaign")}{' '}<ArrowRight size={15} /></Link>} />}
      </Panel>
      <Panel className="campaign-panel" title={t("Campaign progress")} action={<Link to="/campaigns">{t("View all")}{' '}<ArrowRight size={15} /></Link>}>
        {data?.campaigns.length ? <div className="campaign-list">{data.campaigns.map((campaign) => {
          const total = campaign.total ?? 0; const reviewed = campaign.reviewed ?? 0; const progress = total ? Math.round(reviewed / total * 100) : 0
          return <div className="campaign-row" key={campaign.id}><div><strong>{campaign.name}</strong><Status value={campaign.status} /></div><div className="progress"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>
        })}</div> : <EmptyState title={t("No campaigns yet")} detail={t("Campaigns hold the purpose, lawful basis and safe outreach limits.")} />}
      </Panel>
      <Panel title={t("Open reminders")} action={<Link to="/reminders">{t("View all")}{' '}<ArrowRight size={15} /></Link>}>
        {data?.reminders.length ? <ul className="plain-list">{data.reminders.map((reminder) => <li key={reminder.id}><div><strong>{reminder.title}</strong><small>{reminder.prospect_name ?? t("General")} · {reminder.campaign_name ?? t("No campaign")}</small></div><time>{formatDate(reminder.due_at)}</time></li>)}</ul> : <EmptyState title={t("No open reminders")} detail={t("Follow-up decisions created by you or the local worker appear here.")} />}
      </Panel>
      <Panel title={t("Audit trail (latest)")} action={<Link to="/audit">{t("View full log")}{' '}<ArrowRight size={15} /></Link>}>
        {data?.events.length ? <ul className="plain-list audit-preview">{data.events.map((event) => <li key={event.id}><div><strong>{formatCode(event.event_type, '.')}</strong><small>{event.display_name ?? t("System")} · {formatCode(event.entity_type)} {event.entity_id}</small></div><time>{formatDate(event.created_at)}</time></li>)}</ul> : <EmptyState title={t("No actions recorded")} detail={t("Every material local action will be listed here.")} />}
      </Panel>
    </div></DataState>
    <footer className="assisted-note"><Info size={17} />{t("Simbi Reach-Out does not send messages for you. Review content, then copy and open your provider to send manually.")}</footer>
  </div>
}

function SafetyItem({ label, detail, ready }: { label: string; detail: string; ready: boolean }) {
  return <div className="safety-item">{ready ? <CheckCircle2 size={19} /> : <CircleAlert className="warning-icon" size={19} />}<div><strong>{label}</strong><small>{detail}</small></div></div>
}
