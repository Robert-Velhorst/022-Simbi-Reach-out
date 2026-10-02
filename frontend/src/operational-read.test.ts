import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { fictionalMember, operationalReads, populatedOverview, populatedReport } from './test/operational-reads'

afterEach(() => { vi.unstubAllGlobals() })
const response = (value: unknown) => Response.json(value)
const read = (path: string, value: unknown) => {
  const fetcher = vi.fn(async () => response(value))
  vi.stubGlobal('fetch', fetcher)
  return { promise: api(path), fetcher }
}
const damaged: Array<[string, unknown, string]> = [
  ['/auth/status', { ...operationalReads['/auth/status'], setup_required: 'false' }, 'string bootstrap gate'],
  ['/auth/status', { ...operationalReads['/auth/status'], installation_retired: 2 }, 'unrecognized retired gate'],
  ['/auth/status', { ...operationalReads['/auth/status'], setup_token_required: null }, 'null setup token gate'],
  ['/me', { ...operationalReads['/me'], role: 'invented-role' }, 'unrecognized role'],
  ['/me', { ...operationalReads['/me'], user_id: 0 }, 'unsafe user identity'],
  ['/me', { ...operationalReads['/me'], display_name: {} }, 'unrenderable owner name'],
  ['/settings', { ...operationalReads['/settings'], workspace: null }, 'missing safety workspace'],
  ['/settings', { ...operationalReads['/settings'], members: {} }, 'unrenderable member list'],
  ['/settings', { ...operationalReads['/settings'], providers: [...operationalReads['/settings'].providers, ...operationalReads['/settings'].providers] }, 'duplicate provider name with identical fields'],
  ['/settings', { ...operationalReads['/settings'], providers: [...operationalReads['/settings'].providers, { ...operationalReads['/settings'].providers[0], base_url: 'https://simbi.com/contradictory' }] }, 'duplicate provider name with contradictory fields'],
  ['/settings', { ...operationalReads['/settings'], workspace: { ...operationalReads['/settings'].workspace, paused_at: false } }, 'false rather than nullable pause'],
  ['/settings', { ...operationalReads['/settings'], members: [{ ...operationalReads['/settings'].members[0], display_name: null }] }, 'unrenderable member label'],
  ['/overview', { ...populatedOverview, counts: { ...populatedOverview.counts, reviews: -1 } }, 'negative dashboard count'],
  ['/overview', { ...populatedOverview, queue: [{ ...populatedOverview.queue[0], safety_flags: {} }] }, 'unrenderable queue flags'],
  ['/overview', { ...populatedOverview, campaigns: [{ ...populatedOverview.campaigns[0], reviewed: 2 }] }, 'impossible dashboard progress'],
  ['/overview', { ...populatedOverview, safety: { ...populatedOverview.safety, paused: 'false' } }, 'string safety gate'],
  ['/reports/summary', { ...populatedReport, funnel: { ...populatedReport.funnel, total: {} } }, 'unrenderable funnel'],
  ['/reports/summary', { ...populatedReport, campaigns: [{ ...populatedReport.campaigns[0], average_quality: 101 }] }, 'invalid report quality'],
  ['/handoffs?draft_id=1&limit=1', { ...operationalReads['/handoffs'], items: [{ ...operationalReads['/handoffs'].items[0], draft_id: 2 }] }, 'wrong requested conversation'],
  ['/handoffs?draft_id=1&limit=1', { ...operationalReads['/handoffs'], items: [{ ...operationalReads['/handoffs'].items[0], can_open_provider: 'true' }] }, 'unverified copy/open permission'],
]

const requiredReads = [
  { path: '/auth/status', value: operationalReads['/auth/status'], fields: ['setup_required', 'environment', 'demo_mode'] },
  { path: '/me', value: fictionalMember, fields: ['user_id', 'workspace_id', 'email', 'display_name', 'workspace_name', 'role', 'mode', 'compliance_ack_at', 'paused_at', 'environment', 'demo_mode'] },
  { path: '/settings', value: operationalReads['/settings'], fields: ['workspace', 'workspace.name', 'workspace.compliance_ack_at', 'workspace.paused_at', 'workspace.retention_days', 'providers', 'providers.0.provider', 'providers.0.base_url', 'providers.0.mode', 'providers.0.verified_at', 'members', 'members.0.id', 'members.0.display_name', 'members.0.email', 'members.0.role', 'environment', 'demo_mode'] },
  { path: '/overview', value: populatedOverview, fields: ['counts', 'counts.reviews', 'counts.due', 'counts.replies', 'counts.prospects', 'queue', 'queue.0.id', 'queue.0.state', 'queue.0.prospect_name', 'queue.0.campaign_name', 'queue.0.updated_at', 'queue.0.quality_score', 'queue.0.safety_flags', 'campaigns', 'campaigns.0.id', 'campaigns.0.name', 'campaigns.0.status', 'campaigns.0.total', 'campaigns.0.reviewed', 'reminders', 'events', 'safety', 'safety.local_only', 'safety.assisted_send_only', 'safety.compliance_acknowledged', 'safety.paused', 'safety.demo_mode'] },
  { path: '/reports/summary', value: populatedReport, fields: ['funnel', 'funnel.total', 'funnel.needs_review', 'funnel.approved', 'funnel.prepared', 'funnel.sent', 'funnel.replied', 'funnel.suppressed', 'campaigns', 'campaigns.0.id', 'campaigns.0.name', 'campaigns.0.status', 'campaigns.0.drafts', 'campaigns.0.sent', 'campaigns.0.replied', 'campaigns.0.average_quality', 'generated_at', 'local_only'] },
  { path: '/handoffs?draft_id=1&limit=1', value: operationalReads['/handoffs'], fields: ['items', 'items.0.id', 'items.0.draft_id', 'items.0.provider_url', 'items.0.subject', 'items.0.body', 'items.0.status', 'items.0.can_open_provider'] },
]

function damagedField(source: unknown, field: string, missing: boolean): unknown {
  const value = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
  const parts = field.split('.')
  const last = parts.pop()!
  const parent = parts.reduce((row, part) => row[part] as Record<string, unknown>, value)
  if (missing) delete parent[last]
  else parent[last] = { fictional: 'Unrenderable operational read only' }
  return value
}

const requiredFields = requiredReads.flatMap(({ path, value, fields }) => fields.flatMap(field => [true, false].map(missing => ({ path, field, kind: missing ? 'missing' : 'object', value: damagedField(value, field, missing) }))))

const unsafeLinks = ['http://simbi.com/', 'javascript:alert(1)', 'data:text/html,fictional', 'https://owner:secret@simbi.com/', 'https://simbi.com:444/', 'https://simbi.com/\\other', 'https://simbi.com/\nother', 'https://simbi.com/\u007fother']

describe('operational read contracts through the actual shared client', () => {
  it('preserves distinct provider names, historical verification and additive fields without normalization', async () => {
    const value = { ...operationalReads['/settings'], providers: [
      { ...operationalReads['/settings'].providers[0], historical: 'kept' },
      { provider: 'Personal', base_url: 'historical link', mode: 'assisted', verified_at: 'historical verification' },
      { provider: 'personal', base_url: 'https://simbi.com/personal', mode: 'assisted', verified_at: null },
    ] }
    await expect(read('/settings', value).promise).resolves.toEqual(value)
  })
  it.each(requiredFields)('$path refuses $kind required field $field', async ({ path, value }) => {
    const { promise, fetcher } = read(path, value)
    await expect(promise).rejects.toMatchObject({ code: 'response_unverified', details: undefined })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(unsafeLinks)('refuses unsafe active handoff URL %s without opening or copying', async provider_url => {
    const value = { items: [{ ...operationalReads['/handoffs'].items[0], provider_url, can_open_provider: true }] }
    const { promise, fetcher } = read('/handoffs?draft_id=1', value)
    await expect(promise).rejects.toMatchObject({ code: 'response_unverified', details: undefined })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(unsafeLinks)('preserves blocked historical handoff URL %s as ordinary read data', async provider_url => {
    const value = { items: [{ ...operationalReads['/handoffs'].items[0], provider_url, can_open_provider: false }] }
    await expect(read('/handoffs?draft_id=1', value).promise).resolves.toEqual(value)
  })
  it.each(['https://simbi.com/fictional', 'https://simbi.com:443/fictional', 'https://configured.example.test/fictional'])('preserves structurally safe active URL %s; configured-host permission remains the backend decision', async provider_url => {
    const value = { items: [{ ...operationalReads['/handoffs'].items[0], provider_url, can_open_provider: true }] }
    await expect(read('/handoffs?draft_id=1', value).promise).resolves.toEqual(value)
  })
  it.each([
    { path: '/overview', value: { ...populatedOverview, queue: [...populatedOverview.queue, ...populatedOverview.queue] } },
    { path: '/settings', value: { ...operationalReads['/settings'], members: [...operationalReads['/settings'].members, ...operationalReads['/settings'].members] } },
    { path: '/reports/summary', value: { ...populatedReport, campaigns: [...populatedReport.campaigns, ...populatedReport.campaigns] } },
    { path: '/handoffs?draft_id=1', value: { items: [...operationalReads['/handoffs'].items, ...operationalReads['/handoffs'].items] } },
  ])('$path refuses duplicate identity before rendering a record', async ({ path, value }) => {
    await expect(read(path, value).promise).rejects.toMatchObject({ code: 'response_unverified' })
  })
  it.each([true, false, 0, 1])('accepts real retired representation %s', async installation_retired => {
    const value = { ...operationalReads['/auth/status'], installation_retired }
    await expect(read('/auth/status', value).promise).resolves.toEqual(value)
  })
  it('preserves optional bootstrap gates and additive historical fields', async () => {
    const value = { setup_required: false, environment: 'test', demo_mode: false, historical: { unchanged: true } }
    await expect(read('/auth/status', value).promise).resolves.toEqual(value)
  })
  it.each(['/handoffs?draft_id=0', '/handoffs?draft_id=1&draft_id=1', '/handoffs?draft_id=no'])('refuses an invalid handoff read target %s', async path => {
    await expect(read(path, operationalReads['/handoffs']).promise).rejects.toMatchObject({ code: 'response_unverified' })
  })
  it.each(damaged.map(([path, value, name]) => ({ path, value, name })))('$path refuses $name before becoming application state', async ({ path, value }) => {
    const { promise, fetcher } = read(path, value)
    await expect(promise).rejects.toMatchObject({ code: 'response_unverified', details: undefined })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(Object.entries(operationalReads))('accepts actual backend-shaped %s without rewriting it', async (path, value) => {
    const { promise, fetcher } = read(path, value)
    await expect(promise).resolves.toEqual(value)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains confirmed authentication refusal and does not treat it as a malformed successful session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'authentication_required', message: 'Sign in to continue' } }, { status: 401 })))
    await expect(api('/me')).rejects.toEqual(new ApiError('authentication_required', 'Sign in to continue', undefined))
  })
})
