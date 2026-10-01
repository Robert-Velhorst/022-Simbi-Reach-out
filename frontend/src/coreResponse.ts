// Validate the actual backend's core creation contracts before a form is
// dismissed. This is confirmation checking, not a rollback/duplicate receipt.
import { parseTimestamp } from './timestamps'
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback
const boundedText = (value: unknown, minimum: number, maximum: number) => typeof value === 'string' && value.length >= minimum && value.length <= maximum

function sameText(result: RecordValue, submitted: RecordValue, fields: string[]) {
  return fields.every((field) => typeof result[field] === 'string' && result[field] === text(submitted[field]))
}
function sameId(result: RecordValue, submitted: RecordValue, field: string, optional = false) {
  const expected = submitted[field] ?? null
  return optional && expected === null ? result[field] === null : integer(expected, 1) && result[field] === expected
}
function instant(value: unknown): string | null {
  return parseTimestamp(value)?.instantKey ?? null
}
function sameInstant(result: unknown, submitted: unknown) {
  const expected = instant(submitted)
  return expected !== null && instant(result) === expected
}
function source(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function validCoreCreation(path: string, method: string, rawBody: BodyInit | null | undefined, value: unknown): boolean {
  if (method.toUpperCase() !== 'POST' || !['/campaigns', '/prospects', '/templates', '/drafts', '/replies', '/reminders', '/prospects/import'].includes(path.split('?')[0])) return true
  if (!record(value)) return false
  let submitted: RecordValue
  try {
    const decoded: unknown = typeof rawBody === 'string' ? JSON.parse(rawBody) : null
    if (!record(decoded)) return false
    submitted = decoded
  } catch { return false }
  switch (path.split('?')[0]) {
    case '/campaigns':
      return integer(value.id, 1) && boundedText(value.name, 2, 120) && boundedText(value.purpose, 10, 500) && boundedText(value.lawful_basis, 5, 300) && boundedText(value.description, 0, 1000)
        && sameText(value, submitted, ['name', 'description', 'purpose', 'lawful_basis']) && value.status === 'draft'
        && integer(value.daily_limit, 1) && value.daily_limit <= 50 && value.daily_limit === (submitted.daily_limit ?? 10)
        && integer(value.cooldown_minutes, 60) && value.cooldown_minutes <= 43200 && value.cooldown_minutes === (submitted.cooldown_minutes ?? 1440)
    case '/prospects': {
      const expectedSource = source(submitted.source_url)
      return integer(value.id, 1) && boundedText(value.name, 2, 120) && boundedText(value.organization, 0, 160) && boundedText(value.contact_handle, 0, 160) && boundedText(value.notes, 0, 3000)
        && boundedText(value.provider, 2, 40) && boundedText(value.source_url, 8, 1000) && sameText(value, submitted, ['name', 'organization', 'contact_handle', 'notes'])
        && value.provider === text(submitted.provider, 'simbi').toLowerCase()
        && expectedSource !== null && source(value.source_url) === expectedSource
        && [submitted.consent_status ?? 'unknown', 'opted_out'].includes(value.consent_status as string)
        && instant(value.created_at) !== null
    }
    case '/templates':
      return integer(value.id, 1) && integer(value.version, 1) && boundedText(value.name, 2, 120) && boundedText(value.provider, 2, 40) && boundedText(value.subject, 0, 200) && boundedText(value.body, 20, 5000)
        && sameText(value, submitted, ['name', 'subject', 'body'])
        && value.provider === text(submitted.provider, 'simbi').toLowerCase()
    case '/drafts':
      return integer(value.id, 1) && value.state === 'needs_review' && typeof value.quality_score === 'number'
        && ['campaign_id', 'prospect_id', 'template_id'].every((field) => sameId(value, submitted, field))
        && Number.isFinite(value.quality_score) && value.quality_score >= 0 && value.quality_score <= 100
        && Array.isArray(value.safety_flags) && value.safety_flags.every((flag) => typeof flag === 'string')
    case '/replies': return integer(value.id, 1) && value.state === 'replied' && sameId(value, submitted, 'draft_id')
      && boundedText(value.body, 1, 5000) && sameText(value, submitted, ['body']) && instant(value.received_at) !== null
      && (submitted.received_at == null || sameInstant(value.received_at, submitted.received_at))
    case '/reminders': return integer(value.id, 1) && value.status === 'open'
      && sameId(value, submitted, 'draft_id', true) && sameId(value, submitted, 'prospect_id', true)
      && (integer(submitted.draft_id, 1) || integer(submitted.prospect_id, 1))
      && boundedText(value.title, 2, 300) && sameText(value, submitted, ['title']) && sameInstant(value.due_at, submitted.due_at)
    case '/prospects/import': {
      const committed = submitted.commit ?? false
      if (typeof committed !== 'boolean' || value.committed !== committed || !integer(value.valid) || value.valid > 5000
        || !integer(value.inserted) || !integer(value.duplicates) || !Array.isArray(value.errors) || value.errors.length > 50
        || !value.errors.every((error) => record(error) && integer(error.line, 2) && typeof error.message === 'string')) return false
      return committed ? value.errors.length === 0 && value.inserted + value.duplicates === value.valid : value.inserted === 0 && value.duplicates === 0
    }
  }
  return false
}

export function validPage(value: unknown, offset: number, limit: number): boolean {
  return record(value) && Array.isArray(value.items) && integer(value.total) && integer(value.offset)
    && value.offset === offset && integer(value.limit, 1) && value.limit === limit
    && value.items.length <= value.limit && value.items.length <= value.total
}
