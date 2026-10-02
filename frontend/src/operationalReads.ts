import { validPageRecords } from './pageRecords'

// Consumed shapes and local safety gates, not record authenticity or a provider
// integration. Keep extra fields/history; never normalize or persist a payload.
type Row = Record<string, unknown>
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum
const strings = (row: Row, fields: string[]) => fields.every(field => typeof row[field] === 'string')
const bools = (row: Row, fields: string[]) => fields.every(field => typeof row[field] === 'boolean')
const textOrNull = (value: unknown) => value === null || typeof value === 'string'
const countOrNull = (value: unknown) => value === null || integer(value)
const quality = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const role = (value: unknown) => typeof value === 'string' && ['owner', 'admin', 'editor', 'viewer'].includes(value)
const mode = (value: unknown) => value === 'assisted' || value === 'demo'

function activeLink(value: string): boolean {
  // Match the backend's structural gate without replacing its configured-host,
  // permission and current-content checks. Blocked historical strings stay readable.
  if (value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443')
  } catch { return false }
}

function rows(value: unknown, validate: (row: Row) => boolean): boolean {
  if (!Array.isArray(value)) return false
  const ids = new Set<number>()
  return value.every(item => {
    if (!record(item) || !integer(item.id, 1) || ids.has(item.id) || !validate(item)) return false
    ids.add(item.id)
    return true
  })
}

function providerRows(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const names = new Set<string>()
  return value.every(provider => {
    if (!record(provider) || typeof provider.provider !== 'string' || names.has(provider.provider)
      || !strings(provider, ['base_url', 'mode']) || provider.mode !== 'assisted' || !textOrNull(provider.verified_at)) return false
    names.add(provider.provider)
    return true
  })
}

const validators: Record<string, (value: Row) => boolean> = {
  '/auth/status': value => bools(value, ['setup_required', 'demo_mode']) && strings(value, ['environment'])
    // SQLite EXISTS is currently serialized as 0/1; preserve that real contract.
    && (value.installation_retired === undefined || typeof value.installation_retired === 'boolean' || value.installation_retired === 0 || value.installation_retired === 1)
    && (value.setup_token_required === undefined || typeof value.setup_token_required === 'boolean')
    && !(value.setup_required && value.installation_retired),
  '/me': value => integer(value.user_id, 1) && integer(value.workspace_id, 1)
    && strings(value, ['email', 'display_name', 'workspace_name', 'environment']) && role(value.role) && mode(value.mode)
    && textOrNull(value.compliance_ack_at) && textOrNull(value.paused_at) && typeof value.demo_mode === 'boolean',
  '/settings': value => record(value.workspace) && strings(value.workspace, ['name'])
    && textOrNull(value.workspace.compliance_ack_at) && textOrNull(value.workspace.paused_at)
    && integer(value.workspace.retention_days, 30) && value.workspace.retention_days <= 3650
    && providerRows(value.providers)
    && rows(value.members, member => strings(member, ['display_name', 'email']) && role(member.role))
    && strings(value, ['environment']) && typeof value.demo_mode === 'boolean',
  '/overview': value => record(value.counts) && ['reviews', 'due', 'replies', 'prospects'].every(field => integer(value.counts && (value.counts as Row)[field]))
    && rows(value.queue, item => strings(item, ['state', 'prospect_name', 'campaign_name', 'updated_at']) && quality(item.quality_score)
      && Array.isArray(item.safety_flags) && item.safety_flags.every(flag => typeof flag === 'string'))
    && rows(value.campaigns, campaign => strings(campaign, ['name', 'status']) && integer(campaign.total) && integer(campaign.reviewed) && campaign.reviewed <= campaign.total)
    && validPageRecords('/reminders', { items: value.reminders }) && validPageRecords('/audit', { items: value.events })
    && record(value.safety) && bools(value.safety, ['local_only', 'assisted_send_only', 'compliance_acknowledged', 'paused', 'demo_mode'])
    && value.safety.local_only === true && value.safety.assisted_send_only === true,
  '/reports/summary': value => record(value.funnel) && integer(value.funnel.total)
    && ['needs_review', 'approved', 'prepared', 'sent', 'replied', 'suppressed'].every(field => countOrNull((value.funnel as Row)[field]))
    && rows(value.campaigns, campaign => strings(campaign, ['name', 'status']) && integer(campaign.drafts)
      && countOrNull(campaign.sent) && countOrNull(campaign.replied) && (campaign.average_quality === null || quality(campaign.average_quality)))
    && strings(value, ['generated_at']) && value.local_only === true,
  '/handoffs': value => rows(value.items, item => integer(item.draft_id, 1)
    && strings(item, ['provider_url', 'subject', 'body', 'status']) && typeof item.can_open_provider === 'boolean'
    && (!item.can_open_provider || activeLink(item.provider_url as string))),
}

export function validOperationalRead(path: string, value: unknown): boolean {
  const endpoint = path.split('?')[0]
  if (!Object.hasOwn(validators, endpoint)) return true // Other action-specific contracts remain in their modules.
  if (!record(value) || !validators[endpoint](value)) return false
  if (endpoint === '/handoffs') {
    const parameters = new URLSearchParams(path.split('?')[1] ?? '')
    if (parameters.has('draft_id')) {
      const id = Number(parameters.get('draft_id'))
      if (!integer(id, 1) || parameters.getAll('draft_id').length !== 1 || !(value.items as Row[]).every(item => item.draft_id === id)) return false
    }
  }
  return true
}
