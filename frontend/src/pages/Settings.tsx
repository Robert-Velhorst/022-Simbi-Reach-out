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

  if (reauthenticate) return <div className="page"><Panel title="Password changed"><Notice tone="success">All your sessions have been signed out. Sign in with your new password to continue.</Notice><a className="button button-primary" href="/">Sign in again</a></Panel></div>

  return <div className="page settings-page">
    <header className="page-hero"><div><h1>Settings & safety</h1><p>Operator controls are explicit, auditable and local. No provider password or session cookie belongs here.</p></div></header>
    {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    <div className="settings-grid">
      <Panel title="Account password"><p className="panel-intro">Change your local workspace password. This signs out all your sessions, including this one; it never changes a provider password.</p><form className="form-stack" onSubmit={changePassword}><Field label="Current password"><Input name="current_password" type="password" required autoComplete="current-password" /></Field><Field label="New password"><Input name="new_password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></Field><Button disabled={passwordBusy}>Change password</Button></form></Panel>
      <Panel title="Compliance acknowledgement"><p className="panel-intro">Simbi's current terms prohibit unsolicited messages, harvesting, scraping, automated searches and automated agents. Re-check policy before each operational launch.</p>{data?.workspace.compliance_ack_at ? <Notice tone="success"><ShieldCheck size={18} />Acknowledged at {new Date(data.workspace.compliance_ack_at).toLocaleString()}.</Notice> : null}<form className="check-form" onSubmit={compliance}><label><input type="checkbox" name="reviewed_simbi_terms" required />I reviewed the current Simbi terms and acceptable use rules.</label><label><input type="checkbox" name="confirmed_no_scraping" required />I will only use manually supplied or authorized records; no scraping or harvesting.</label><label><input type="checkbox" name="confirmed_manual_send" required />I understand every external send remains manual.</label><label><input type="checkbox" name="confirmed_suppression_process" required />I will record opt-outs and stop outreach immediately.</label><Button disabled={!canAdmin}>Record acknowledgement</Button></form></Panel>
      <Panel title="Emergency safety stop"><p className="panel-intro">The stop blocks new approvals and provider handoffs. Local edits, exports and reply recording remain available for recovery.</p>{data?.workspace.paused_at ? <Notice tone="danger"><AlertOctagon size={18} />Paused since {new Date(data.workspace.paused_at).toLocaleString()}.</Notice> : <Notice tone="success">The workspace is operating under its normal approval gates.</Notice>}<Button variant={data?.workspace.paused_at ? 'secondary' : 'danger'} disabled={!canAdmin} onClick={() => pause(!data?.workspace.paused_at)}>{data?.workspace.paused_at ? 'Resume guarded workflow' : 'Enable safety stop'}</Button></Panel>
      <Panel title="Provider handoff"><p className="panel-intro">Only an HTTPS base link is stored. The backend restricts handoffs to the same approved hostname.</p><form className="form-stack" key={data?.providers[0]?.base_url ?? "loading"} onSubmit={provider}><Field label="Provider"><Input name="provider" defaultValue="simbi" required disabled={!canAdmin} /></Field><Field label="HTTPS base URL"><Input name="base_url" type="url" defaultValue={data?.providers[0]?.base_url ?? 'https://simbi.com/'} required disabled={!canAdmin} /></Field><Button variant="secondary" disabled={!canAdmin}>Save assisted provider</Button></form></Panel>
      <Panel title="Data controls"><p className="panel-intro">Exports contain workspace records. Support bundles are separately redacted and contain only diagnostics.</p><div className="button-stack"><a className="button button-secondary" href="/api/export" target="_blank" rel="noreferrer"><Download size={17} />Export workspace JSON</a><a className="button button-secondary" href="/api/support-bundle" target="_blank" rel="noreferrer"><DatabaseBackup size={17} />Download redacted support data</a></div><small>Retention window: {data?.workspace.retention_days ?? '—'} days. Suppression records are retained so opt-outs are not forgotten.</small></Panel>
      <Panel title="Local team"><div className="member-list">{data?.members.map((item) => <div key={item.id}><span className="avatar">{item.display_name[0]}</span><div><strong>{item.display_name}</strong><small>{item.email}</small></div><span>{item.role}</span></div>)}</div>{canAdmin ? <form className="form-grid compact" onSubmit={addMember}><Field label="Name"><Input name="display_name" required /></Field><Field label="Email"><Input name="email" type="email" required /></Field><Field label="Temporary password"><Input name="password" type="password" minLength={12} required /></Field><Field label="Role"><Select name="role" defaultValue="viewer"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></Select></Field><Button><UserPlus size={17} />Add member</Button></form> : null}</Panel>
      <Panel title="Runtime"><dl className="definition-list"><div><dt>Environment</dt><dd>{data?.environment}</dd></div><div><dt>Mode</dt><dd>{data?.demo_mode ? 'Demo — handoffs blocked' : 'Local assisted'}</dd></div><div><dt>Authentication</dt><dd>Local session + CSRF</dd></div><div><dt>Storage</dt><dd>SQLite on this machine</dd></div></dl></Panel>
    </div>
  </div>
}
