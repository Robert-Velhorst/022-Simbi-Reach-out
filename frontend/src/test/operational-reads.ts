import { coreReadRows } from './page-records'

// Complete fictional server-shaped reads; apply damage after these defaults.
export const fictionalMember = { user_id: 1, workspace_id: 1, email: 'fictional@example.test', display_name: 'Fictional owner', workspace_name: 'Fictional workspace', role: 'owner', mode: 'assisted', compliance_ack_at: null, paused_at: null, environment: 'test', demo_mode: false }
export const operationalReads = {
  '/auth/status': { setup_required: false, installation_retired: 0, setup_token_required: false, environment: 'test', demo_mode: false },
  '/me': fictionalMember,
  '/overview': { counts: { reviews: 0, due: 0, replies: 0, prospects: 0 }, queue: [], campaigns: [], reminders: [], events: [], safety: { local_only: true, assisted_send_only: true, compliance_acknowledged: false, paused: false, demo_mode: false } },
  '/reports/summary': { funnel: { total: 0, needs_review: null, approved: null, prepared: null, sent: null, replied: null, suppressed: null }, campaigns: [], generated_at: '2026-10-02T12:00:00Z', local_only: true },
  '/settings': { workspace: { name: 'Fictional workspace', compliance_ack_at: null, paused_at: null, retention_days: 365 }, providers: [{ provider: 'simbi', base_url: 'https://simbi.com/', mode: 'assisted', verified_at: null }], members: [{ id: 1, email: fictionalMember.email, display_name: fictionalMember.display_name, role: 'owner' }], environment: 'test', demo_mode: false },
  '/handoffs': { items: [{ id: 1, draft_id: 1, provider_url: 'https://simbi.com/never-send', subject: 'Fictional approved text', body: 'Never send this fictional message', status: 'prepared', can_open_provider: false }] },
}

export const populatedOverview = { ...operationalReads['/overview'], counts: { reviews: 1, due: 0, replies: 0, prospects: 1 }, queue: [{ ...coreReadRows.drafts }], campaigns: [{ id: 1, name: 'Fictional campaign', status: 'draft', total: 1, reviewed: 0 }], reminders: [{ ...coreReadRows.reminders }], events: [{ ...coreReadRows.audit }] }
export const populatedReport = { ...operationalReads['/reports/summary'], funnel: { total: 1, needs_review: 1, approved: 0, prepared: 0, sent: 0, replied: 0, suppressed: 0 }, campaigns: [{ id: 1, name: 'Fictional campaign', status: 'draft', drafts: 1, sent: 0, replied: 0, average_quality: 80 }] }
