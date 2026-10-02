import { useI18n } from '../i18n'
import { useState, type FormEvent } from 'react'
import { AlertOctagon, DatabaseBackup, Download, ShieldCheck, UserPlus } from 'lucide-react'
import { api, ApiError, post } from '../api'
import { Button, Field, Input, Notice, Panel, Select } from '../components/ui'
import type { Member } from '../types'
import PrivacyControls from '../components/PrivacyControls'
import AuditPrivacyControls from '../components/AuditPrivacyControls'
import { usePendingMutation } from '../components/usePendingMutation'
import { parseTimestamp } from '../timestamps'
import RetirementControls, { type RetirementReceipt } from '../components/RetirementControls'
import { useResource } from '../useResource'
import { DataState } from '../components/DataState'

type SettingsData = {
  workspace: { name: string; compliance_ack_at: string | null; paused_at: string | null; retention_days: number }
  providers: Array<{ provider: string; base_url: string; mode: string; verified_at: string | null }>
  members: Array<{ id: number; display_name: string; email: string; role: string }>
  environment: string
  demo_mode: boolean
}

const sameTimestamp = (left: string | null, right: string | null) => left === null || right === null
  ? left === right : Boolean(parseTimestamp(left)) && parseTimestamp(left)?.instantKey === parseTimestamp(right)?.instantKey
const unverifiedSettings = () => new ApiError('response_unverified', 'Settings could not be verified. Retry the settings read before repeating a change; the earlier change may already be saved.')

export default function SettingsPage({ member, onMemberChange, onRetired = () => window.location.reload() }: { member: Member; onMemberChange: (member: Member) => void; onRetired?: (receipt: RetirementReceipt) => void }) {
  const { t, formatMessage, formatCode, formatDate } = useI18n()
  const resource = useResource<SettingsData>('/settings')
  const { data, loading, error } = resource
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [complianceBusy, setComplianceBusy] = useState(false)
  const safetyAction = usePendingMutation()
  const [safetyUncertain, setSafetyUncertain] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('simbi')
  const [providerDraft, setProviderDraft] = useState<{ provider: string; base_url: string } | null>(null)
  const loadedProvider = data?.providers.find(item => item.provider === selectedProvider) ?? data?.providers[0]
  const providerValues = providerDraft ?? { provider: loadedProvider?.provider ?? 'simbi', base_url: loadedProvider?.base_url ?? 'https://simbi.com/' }
  const [reauthenticate, setReauthenticate] = useState(false)
  const canAdmin = ['owner', 'admin'].includes(member.role) && Boolean(data) && !loading && !error
  const canChangeSafety = canAdmin && !safetyAction.busy && !safetyUncertain
  async function readSettings() {
    const next = await resource.load()
    if (next && safetyUncertain) { setSafetyUncertain(false); setMessage(null) }
    return next
  }
  async function load() {
    const next = await resource.load()
    if (!next) throw unverifiedSettings()
    return next
  }
  async function refreshMember() {
    const next = await api<Member>('/me')
    if (next.user_id !== member.user_id || next.workspace_id !== member.workspace_id) throw unverifiedSettings()
    onMemberChange(next)
    return next
  }

  async function compliance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canChangeSafety || !safetyAction.begin(event.currentTarget)) return
    const form = new FormData(event.currentTarget)
    const names = ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process']
    setComplianceBusy(true); setMessage(null)
    try {
      const receipt = await post<{ compliance_ack_at: string }>('/settings/compliance', Object.fromEntries(names.map((name) => [name, form.get(name) === 'on'])))
      const [settings, current] = await Promise.all([load(), refreshMember()])
      if (!sameTimestamp(settings.workspace.compliance_ack_at, receipt.compliance_ack_at) || !sameTimestamp(current.compliance_ack_at, receipt.compliance_ack_at)) throw unverifiedSettings()
      setMessage({ tone: 'success', text: 'Compliance acknowledgement recorded in the audit log.' })
    }
    catch (cause) { setSafetyUncertain(true); setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Could not save compliance review' }) }
    finally { setComplianceBusy(false); safetyAction.end() }
  }

  async function provider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canChangeSafety || !safetyAction.begin(event.currentTarget)) return; setMessage(null)
    try {
      const receipt = await post<{ provider: string; base_url: string }>('/settings/provider', Object.fromEntries(new FormData(event.currentTarget)))
      const settings = await load()
      if (!settings.providers.some(item => item.provider === receipt.provider && item.base_url === receipt.base_url && item.mode === 'assisted' && item.verified_at === null)) throw unverifiedSettings()
      setSelectedProvider(receipt.provider); setProviderDraft(null)
      setMessage({ tone: 'success', text: 'Provider link saved. Assisted mode remains enforced.' })
    }
    catch (cause) { setSafetyUncertain(true); setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Provider could not be saved' }) }
    finally { safetyAction.end() }
  }

  async function pause(paused: boolean) {
    if (!canChangeSafety || !safetyAction.begin()) return
    setMessage(null)
    try {
      const receipt = await post<{ paused: boolean; paused_at: string | null }>('/settings/pause', { paused })
      const [settings, current] = await Promise.all([load(), refreshMember()])
      if (!sameTimestamp(settings.workspace.paused_at, receipt.paused_at) || !sameTimestamp(current.paused_at, receipt.paused_at)) throw unverifiedSettings()
      setMessage({ tone: 'success', text: paused ? 'Safety stop enabled. New approvals and handoffs are blocked.' : 'Workspace resumed. Existing review gates still apply.' })
    }
    catch (cause) { setSafetyUncertain(true); setMessage({ tone: 'danger', text: cause instanceof ApiError ? cause.message : 'Safety state could not be changed' }) }
    finally { safetyAction.end() }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canAdmin) return; setMessage(null)
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
    <header className="page-hero"><div><h1>{t("Settings & safety")}</h1><p>{t("Operator controls are explicit, auditable and local. No provider password or session cookie belongs here.")}</p></div><Button variant="secondary" disabled={loading || safetyAction.busy} onClick={() => void readSettings()}>{t('Refresh')}</Button></header>
    {message ? <Notice tone={message.tone}>{formatMessage(message.text)}</Notice> : null}
    <DataState label={t('settings')} loading={loading} error={error} hasData={Boolean(data)} retry={readSettings}><div className="settings-grid">
      {member.role === 'owner' && data ? <PrivacyControls retentionDays={data.workspace.retention_days} onSaved={async () => { await load() }} /> : null}
      {member.role === 'owner' && data ? <AuditPrivacyControls /> : null}
      <Panel title={t("Account password")}><p className="panel-intro">{t("Change your local workspace password. This signs out all your sessions, including this one; it never changes a provider password.")}</p><form className="form-stack" onSubmit={changePassword}><Field label={t("Current password")}><Input name="current_password" type="password" required autoComplete="current-password" /></Field><Field label={t("New password")}><Input name="new_password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></Field><Button disabled={passwordBusy}>{t("Change password")}</Button></form></Panel>
      <Panel title={t("Compliance acknowledgement")}>
        <p className="panel-intro">{t("Simbi's current terms prohibit unsolicited messages, harvesting, scraping, automated searches and automated agents. Re-check policy before each operational launch.")}</p>
        {!safetyUncertain && !safetyAction.busy && data?.workspace.compliance_ack_at ? <Notice tone="success"><ShieldCheck size={18} />{t('Acknowledged at {date}.', { date: formatDate(data.workspace.compliance_ack_at) })}</Notice> : null}
        <form className="check-form" onSubmit={compliance}>
          <label><input type="checkbox" name="reviewed_simbi_terms" required disabled={!canChangeSafety} />{t("I reviewed the current Simbi terms and acceptable use rules.")}</label>
          <label><input type="checkbox" name="confirmed_no_scraping" required disabled={!canChangeSafety} />{t("I will only use manually supplied or authorized records; no scraping or harvesting.")}</label>
          <label><input type="checkbox" name="confirmed_manual_send" required disabled={!canChangeSafety} />{t("I understand every external send remains manual.")}</label>
          <label><input type="checkbox" name="confirmed_suppression_process" required disabled={!canChangeSafety} />{t("I will record opt-outs and stop outreach immediately.")}</label>
          <Button disabled={!canChangeSafety}>{t(complianceBusy ? "Recording acknowledgement…" : "Record acknowledgement")}</Button>
        </form>
      </Panel>
      <Panel title={t("Emergency safety stop")}>
        <p className="panel-intro">{t("The stop blocks new approvals and provider handoffs. Local edits, exports and reply recording remain available for recovery.")}</p>
        {safetyAction.busy ? <Notice>{t('A request is still pending. Stay here until it finishes, then check its result before retrying or closing this form.')}</Notice> : safetyUncertain ? <Notice tone="warning">{t('Safety settings may have changed. Refresh Settings before another safety change.')}</Notice> : data?.workspace.paused_at ? <Notice tone="danger"><AlertOctagon size={18} />{t('Paused since {date}.', { date: formatDate(data.workspace.paused_at) })}</Notice> : <Notice tone="success">{t("The workspace is operating under its normal approval gates.")}</Notice>}
        <Button variant={data?.workspace.paused_at ? 'secondary' : 'danger'} disabled={!canChangeSafety} onClick={() => pause(!data?.workspace.paused_at)}>{data?.workspace.paused_at ? t("Resume guarded workflow") : t("Enable safety stop")}</Button>
      </Panel>
      <Panel title={t("Provider handoff")}>
        <p className="panel-intro">{t("Only an HTTPS base link is stored. The backend restricts handoffs to the same approved hostname.")}</p>
        <p className="panel-intro provider-snapshot">{t('Last loaded provider: {provider} — {url}.', { provider: loadedProvider?.provider ?? '—', url: loadedProvider?.base_url ?? '—' })}</p>
        {providerDraft ? <Notice>{t('Your provider edits are kept on this page. Refresh only reads saved settings; it does not save these edits.')}</Notice> : null}
        <form className="form-stack" onSubmit={provider}>
          <Field label={t("Provider")}><Input name="provider" value={providerValues.provider} onChange={event => setProviderDraft({ ...providerValues, provider: event.target.value })} required disabled={!canChangeSafety} /></Field>
          <Field label={t("HTTPS base URL")}><Input name="base_url" type="url" value={providerValues.base_url} onChange={event => setProviderDraft({ ...providerValues, base_url: event.target.value })} required disabled={!canChangeSafety} /></Field>
          <Button variant="secondary" disabled={!canChangeSafety}>{t("Save assisted provider")}</Button>
        </form>
      </Panel>
      <Panel title={t("Data controls")}><p className="panel-intro">{t("Exports contain workspace records. Support bundles are separately redacted and contain only diagnostics.")}</p>{canAdmin ? <div className="button-stack"><a className="button button-secondary" href="/api/export" target="_blank" rel="noreferrer"><Download size={17} />{t("Export workspace JSON")}</a><a className="button button-secondary" href="/api/support-bundle" target="_blank" rel="noreferrer"><DatabaseBackup size={17} />{t("Download redacted support data")}</a></div> : <Notice>{t("Ask a workspace owner or admin to export workspace records or download redacted support data.")}</Notice>}<small>{t('Retention window: {days} days. Suppression records are retained so opt-outs are not forgotten.', { days: data?.workspace.retention_days ?? '—' })}</small></Panel>
      <Panel title={t("Local team")}><div className="member-list">{data?.members.map((item) => <div key={item.id}><span className="avatar">{item.display_name[0]}</span><div><strong>{item.display_name}</strong><small>{item.email}</small></div><span>{formatCode(item.role)}</span></div>)}</div>{canAdmin ? <form className="form-grid compact" onSubmit={addMember}><Field label={t("Name")}><Input name="display_name" required /></Field><Field label={t("Email")}><Input name="email" type="email" required /></Field><Field label={t("Temporary password")}><Input name="password" type="password" minLength={12} required /></Field><Field label={t("Role")}><Select name="role" defaultValue="viewer"><option value="viewer">{t("Viewer")}</option><option value="editor">{t("Editor")}</option><option value="admin">{t("Admin")}</option></Select></Field><Button><UserPlus size={17} />{t("Add member")}</Button></form> : null}</Panel>
      <Panel title={t("Runtime")}><dl className="definition-list"><div><dt>{t("Environment")}</dt><dd>{data?.environment ? formatCode(data.environment) : '—'}</dd></div><div><dt>{t("Mode")}</dt><dd>{data?.demo_mode ? t("Demo — handoffs blocked") : t("Local assisted")}</dd></div><div><dt>{t("Authentication")}</dt><dd>{t("Local session + CSRF")}</dd></div><div><dt>{t("Storage")}</dt><dd>{t("SQLite on this machine")}</dd></div></dl></Panel>
      {member.role === 'owner' && data ? <RetirementControls paused={Boolean(data.workspace.paused_at)} onRetired={onRetired} /> : null}
    </div></DataState>
  </div>
}
