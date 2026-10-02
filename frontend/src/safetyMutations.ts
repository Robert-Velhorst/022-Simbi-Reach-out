import { parseTimestamp } from './timestamps'

type Row = Record<string, unknown>
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value)
const instant = (value: unknown) => parseTimestamp(value)?.instantKey

// Mirror the backend's provider-link normalization, not URL.href (which changes
// trailing slashes, encoding and Unicode hosts). Server host/permission checks
// remain authoritative; this only binds a confirmation to this submitted link.
function providerURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
  const stripped = value.trim()
  try {
    const url = new URL(stripped)
    const parts = /^https:\/\/([^/?#]+)([^#]*)(?:#.*)?$/i.exec(stripped)
    if (!parts || !url.hostname || url.username || url.password || (url.port && url.port !== '443')) return null
    let suffix = parts[2]
    const question = suffix.indexOf('?')
    if (question >= 0 && question === suffix.length - 1) suffix = suffix.slice(0, -1) // Only an empty query delimiter.
    const query = suffix.indexOf('?')
    const path = query < 0 ? suffix : suffix.slice(0, query)
    const semicolon = path.indexOf(';', path.lastIndexOf('/') + 1)
    if (semicolon >= 0 && semicolon === path.length - 1) suffix = path.slice(0, -1) + (query < 0 ? '' : suffix.slice(query))
    return `https://${parts[1].toLowerCase().replace(/:\d*$/, '')}${suffix}`
  } catch { return null }
}

export function validSafetyMutation(path: string, method: string, body: unknown, value: unknown): boolean {
  const endpoint = path.split('?')[0]
  if (method.toUpperCase() !== 'POST' || !['/settings/pause', '/settings/compliance', '/settings/provider'].includes(endpoint)) return true
  let submitted: unknown
  try { submitted = typeof body === 'string' ? JSON.parse(body) : null } catch { return false }
  if (!record(submitted) || !record(value)) return false
  if (endpoint === '/settings/pause') return typeof submitted.paused === 'boolean' && value.paused === submitted.paused
    && (submitted.paused ? Boolean(instant(value.paused_at)) : value.paused_at === null)
  if (endpoint === '/settings/compliance') return ['reviewed_simbi_terms', 'confirmed_no_scraping', 'confirmed_manual_send', 'confirmed_suppression_process'].every(field => submitted[field] === true)
    && Boolean(instant(value.compliance_ack_at))
  const expectedURL = providerURL(submitted.base_url)
  return typeof submitted.provider === 'string' && value.provider === submitted.provider.toLowerCase()
    && expectedURL !== null && value.base_url === expectedURL && value.mode === 'assisted' && value.verified === false
}
