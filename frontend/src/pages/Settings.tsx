import { useI18n } from '../i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { AlertOctagon, DatabaseBackup, Download, ShieldCheck, UserPlus } from 'lucide-react'
import { api, ApiError, post } from '../api'
import { Button, Field, Input, Notice, Panel, Select } from '../components/ui'
import type { Member } from '../types'

type SettingsData = {
  workspace: { name: string; compliance_ack_at: string | null; paused_at: string | null; retention_days: number }
  providers: Array<{ provider: string; base_url: string; mode: string; verified_at: string | null }>
  members: Array<{ id: number; display_name: string; email: string; role: string }>
  environment: string
  demo_mode: boolean
}

export default function SettingsPage({ member, onMemberChange }: { member: Member; onMemberChange: (member: Member) => void }) {
  const { t, formatMessage, formatCode, formatDate } = useI18n()
  const [data, setData] = useState<SettingsData | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [reauthenticate, setReauthenticate] = useState(false)
  const canAdmin = ['owner', 'admin'].includes(member.role)
  async function load() { setData(await api<SettingsData>('/settings')) }
  async function refreshMember() { onMemberChange(await api<Member>('/me')) }
  useEffect(() => { void load().catch((cause) => setMessage({ tone: 'danger', text: cause instanceof Error ? cause.message : 'Settings could not be loaded' })) }, [])

  async function compliance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null)
    const form = new FormData(event.currentTarget)
    const names = ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process']
    try { await post('/settings/compliance', Object.fromEntries(names.map((name) => [name, form.get(name) === 'on']))); await Promise.all([load(), refreshMember()]); setMessage({ tone: 'success', text: 'Compliance acknowledgement recorded in the audit log.' }) }
    catch (cause) { setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Could not save compliance review' }) }
  }

  async function provider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null)
    try { await post('/settings/provider', Object.fromEntries(new FormData(event.currentTarget))); await load(); setMessage({ tone: 'success', text: 'Provider link saved. Assisted mode remains enforced.' }) }
    catch (cause) { setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Provider could not be saved' }) }
  }

  async function pause(paused: boolean) {
    setMessage(null)
    try { await post('/settings/pause', { paused }); await Promise.all([load(), refreshMember()]); setMessage({ tone: 'success', text: paused ? 'Safety stop enabled. New approvals and handoffs are blocked.' : 'Workspace resumed. Existing review gates still apply.' }) }
    catch (cause) { setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Safety state could not be changed' }) }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null)
    const form = event.currentTarget
    try { await post('/settings/team', Object.fromEntries(new FormData(form))); form.reset(); await load(); setMessage({ tone: 'success', text: 'Local team member added.' }) }
    catch (cause) { setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Member could not be added' }) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (passwordBusy) return
    const form = event.currentTarget
    setMessage(null); setPasswordBusy(true)
    try {
      await post('/auth/password', Object.fromEntries(new FormData(form)))
      form.reset(); setReauthenticate(true)
    } catch (cause) { setMessage({ tone: 'danger', text: cause instanceof Error ? cause.message : 'Password could not be changed' }) }
    finally { setPasswordBusy(false) }
  }

  if (reauthenticate) return <div className="page"><Panel title={t("Password changed")}><Notice tone="success">{t("All your sessions have been signed out. Sign in with your new password to continue.")}</Notice><a className="button button-primary" href="/">{t("Sign in again")}</a></Panel></div>

  return <div className="page settings-page">
    <header className="page-hero"><div><h1>{t("Settings & safety")}</h1><p>{t("Operator controls are explicit, auditable and local. No provider password or session cookie belongs here.")}</p></div></header>
    {message ? <Notice tone={message.tone}>{formatMessage(message.text)}</Notice> : null}
    <div className="settings-grid">
      <Panel title={t("Account password")}><p className="panel-intro">{t("Change your local workspace password. This signs out all your sessions, including this one; it never changes a provider password.")}</p><form className="form-stack" onSubmit={changePassword}><Field label={t("Current password")}><Input name="current_password" type="password" required autoComplete="current-password" /></Field><Field label={t("New password")}><Input name="new_password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></Field><Button disabled={passwordBusy}>{t("Change password")}</Button></form></Panel>
      <Panel title={t("Compliance acknowledgement")}><p className="panel-intro">{t("Simbi's current terms prohibit unsolicited messages, harvesting, scraping, automated searches and automated agents. Re-check policy before each operational launch.")}</p>{data?.workspace.compliance_ack_at ? <Notice tone="success"><ShieldCheck size={18} />{t('Acknowledged at {date}.', { date: formatDate(data.workspace.compliance_ack_at) })}</Notice> : null}<form className="check-form" onSubmit={compliance}><label><input type="checkbox" name="reviewed_simbi_terms" required />{t("I reviewed the current Simbi terms and acceptable use rules.")}</label><label><input type="checkbox" name="confirmed_no_scraping" required />{t("I will only use manually supplied or authorized records; no scraping or harvesting.")}</label><label><input type="checkbox" name="confirmed_manual_send" required />{t("I understand every external send remains manual.")}</label><label><input type="checkbox" name="confirmed_suppression_process" required />{t("I will record opt-outs and stop outreach immediately.")}</label><Button disabled={!canAdmin}>{t("Record acknowledgement")}</Button></form></Panel>
      <Panel title={t("Emergency safety stop")}><p className="panel-intro">{t("The stop blocks new approvals and provider handoffs. Local edits, exports and reply recording remain available for recovery.")}</p>{data?.workspace.paused_at ? <Notice tone="danger"><AlertOctagon size={18} />{t('Paused since {date}.', { date: formatDate(data.workspace.paused_at) })}</Notice> : <Notice tone="success">{t("The workspace is operating under its normal approval gates.")}</Notice>}<Button variant={data?.workspace.paused_at ? 'secondary' : 'danger'} disabled={!canAdmin} onClick={() => pause(!data?.workspace.paused_at)}>{data?.workspace.paused_at ? t("Resume guarded workflow") : t("Enable safety stop")}</Button></Panel>
      <Panel title={t("Provider handoff")}><p className="panel-intro">{t("Only an HTTPS base link is stored. The backend restricts handoffs to the same approved hostname.")}</p><form className="form-stack" key={data?.providers[0]?.base_url ?? "loading"} onSubmit={provider}><Field label={t("Provider")}><Input name="provider" defaultValue="simbi" required disabled={!canAdmin} /></Field><Field label={t("HTTPS base URL")}><Input name="base_url" type="url" defaultValue={data?.providers[0]?.base_url ?? 'https://simbi.com/'} required disabled={!canAdmin} /></Field><Button variant="secondary" disabled={!canAdmin}>{t("Save assisted provider")}</Button></form></Panel>
      <Panel title={t("Data controls")}><p className="panel-intro">{t("Exports contain workspace records. Support bundles are separately redacted and contain only diagnostics.")}</p>{canAdmin ? <div className="button-stack"><a className="button button-secondary" href="/api/export" target="_blank" rel="noreferrer"><Download size={17} />{t("Export workspace JSON")}</a><a className="button button-secondary" href="/api/support-bundle" target="_blank" rel="noreferrer"><DatabaseBackup size={17} />{t("Download redacted support data")}</a></div> : <Notice>{t("Ask a workspace owner or admin to export workspace records or download redacted support data.")}</Notice>}<small>{t('Retention window: {days} days. Suppression records are retained so opt-outs are not forgotten.', { days: data?.workspace.retention_days ?? '—' })}</small></Panel>
      <Panel title={t("Local team")}><div className="member-list">{data?.members.map((item) => <div key={item.id}><span className="avatar">{item.display_name[0]}</span><div><strong>{item.display_name}</strong><small>{item.email}</small></div><span>{formatCode(item.role)}</span></div>)}</div>{canAdmin ? <form className="form-grid compact" onSubmit={addMember}><Field label={t("Name")}><Input name="display_name" required /></Field><Field label={t("Email")}><Input name="email" type="email" required /></Field><Field label={t("Temporary password")}><Input name="password" type="password" minLength={12} required /></Field><Field label={t("Role")}><Select name="role" defaultValue="viewer"><option value="viewer">{t("Viewer")}</option><option value="editor">{t("Editor")}</option><option value="admin">{t("Admin")}</option></Select></Field><Button><UserPlus size={17} />{t("Add member")}</Button></form> : null}</Panel>
      <Panel title={t("Runtime")}><dl className="definition-list"><div><dt>{t("Environment")}</dt><dd>{data?.environment ? formatCode(data.environment) : '—'}</dd></div><div><dt>{t("Mode")}</dt><dd>{data?.demo_mode ? t("Demo — handoffs blocked") : t("Local assisted")}</dd></div><div><dt>{t("Authentication")}</dt><dd>{t("Local session + CSRF")}</dd></div><div><dt>{t("Storage")}</dt><dd>{t("SQLite on this machine")}</dd></div></dl></Panel>
    </div>
  </div>
}
