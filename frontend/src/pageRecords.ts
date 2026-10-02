// Core paged reads must be safe to render/select before they become UI state.
// This validates consumed shapes, not historical dates/status policy or every
// server field. It never repairs records, strips additive fields or caches bodies.
type Row = Record<string, unknown>
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum
const strings = (row: Row, fields: string[]) => fields.every(field => typeof row[field] === 'string')
const nullableText = (value: unknown) => value === null || typeof value === 'string'
const nullableId = (value: unknown) => value === null || integer(value, 1)
const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100

const validators: Record<string, (row: Row) => boolean> = {
  '/campaigns': row => strings(row, ['name', 'description', 'purpose', 'lawful_basis', 'status'])
    && integer(row.daily_limit, 1) && integer(row.cooldown_minutes, 1)
    && ['total', 'reviewed'].every(field => row[field] === undefined || integer(row[field])),
  '/prospects': row => strings(row, ['name', 'organization', 'provider', 'source_url', 'contact_handle', 'notes', 'consent_status', 'created_at']),
  '/templates': row => strings(row, ['name', 'provider', 'subject', 'body']) && integer(row.version, 1),
  '/drafts': row => strings(row, ['prospect_name', 'organization', 'source_url', 'consent_status', 'campaign_name', 'subject', 'body', 'state', 'content_hash', 'edit_version', 'updated_at'])
    && integer(row.campaign_id, 1) && integer(row.prospect_id, 1) && nullableId(row.template_id) && nullableText(row.template_name)
    && score(row.quality_score) && Array.isArray(row.safety_flags) && row.safety_flags.every(flag => typeof flag === 'string'),
  '/replies': row => strings(row, ['prospect_name', 'campaign_name', 'body', 'received_at', 'direction']) && integer(row.draft_id, 1),
  '/reminders': row => strings(row, ['title', 'due_at', 'status']) && nullableText(row.prospect_name) && nullableText(row.campaign_name),
  '/audit': row => strings(row, ['event_type', 'entity_type', 'entity_id', 'created_at']) && nullableText(row.display_name),
}

export function validPageRecords(path: string, value: unknown): boolean {
  const validate = Object.hasOwn(validators, path.split('?')[0]) ? validators[path.split('?')[0]] : undefined
  if (!validate) return true // Other endpoints retain their own contracts.
  if (!record(value) || !Array.isArray(value.items)) return false
  const ids = new Set<number>()
  return value.items.every(item => {
    if (!record(item) || !integer(item.id, 1) || ids.has(item.id) || !validate(item)) return false
    ids.add(item.id)
    return true
  })
}
