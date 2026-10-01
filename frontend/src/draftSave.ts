import type { Draft } from './types'

const versionPattern = /^[a-f0-9]{64}$/
const states = new Set(['needs_review', 'approved', 'declined', 'handoff_created', 'ambiguous', 'sent', 'replied', 'suppressed'])

export function hasEditVersion(value: unknown): value is string {
  return typeof value === 'string' && versionPattern.test(value)
}

// Validate the exact record and submitted text before clearing private local edits.
// A read is current-state evidence, not a receipt for a particular past write.
export function verifiedDraft(value: unknown, id: number, text?: { subject: string; body: string }): Draft | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<Draft>
  if (item.id !== id || !hasEditVersion(item.edit_version) || !hasEditVersion(item.content_hash)
    || typeof item.subject !== 'string' || typeof item.body !== 'string'
    || !states.has(String(item.state)) || typeof item.quality_score !== 'number'
    || !Number.isInteger(item.quality_score) || item.quality_score < 0 || item.quality_score > 100
    || !Array.isArray(item.safety_flags) || !item.safety_flags.every((flag) => typeof flag === 'string')
    || typeof item.updated_at !== 'string' || !Number.isFinite(Date.parse(item.updated_at))
    || typeof item.prospect_name !== 'string' || typeof item.campaign_name !== 'string'
    || typeof item.source_url !== 'string' || typeof item.consent_status !== 'string') return null
  if (text && (item.subject !== text.subject || item.body !== text.body || item.state !== 'needs_review')) return null
  return item as Draft
}
