// Complete fictional core read fixtures. Spread explicit changes AFTER these
// defaults; never normalize a damaged response at the fetch/mock seam.
export const coreReadRows = {
  campaigns: { id: 1, name: 'Fictional campaign', description: '', purpose: 'Local fixture only', lawful_basis: 'Not provider permission', status: 'draft', daily_limit: 10, cooldown_minutes: 1440, total: 0, reviewed: 0 },
  prospects: { id: 1, name: 'Fictional person', organization: '', provider: 'simbi', source_url: 'https://simbi.com/never-send', contact_handle: '', notes: '', consent_status: 'unknown', created_at: '2026-10-02T12:00:00Z' },
  templates: { id: 1, name: 'Fictional template', provider: 'simbi', subject: '', body: 'Fictional local template only', version: 1 },
  drafts: { id: 1, campaign_id: 1, prospect_id: 1, template_id: 1, prospect_name: 'Fictional person', organization: '', source_url: 'https://simbi.com/never-send', consent_status: 'unknown', campaign_name: 'Fictional campaign', template_name: 'Fictional template', subject: '', body: 'Fictional local draft only', state: 'needs_review', quality_score: 80, safety_flags: [] as string[], content_hash: 'a'.repeat(64), edit_version: 'b'.repeat(64), updated_at: '2026-10-02T12:00:00Z' },
  replies: { id: 1, draft_id: 1, prospect_name: 'Fictional person', campaign_name: 'Fictional campaign', body: 'Fictional local reply only', received_at: '2026-10-02T12:00:00Z', direction: 'inbound' },
  reminders: { id: 1, title: 'Fictional reminder', due_at: '2026-10-03T12:00:00Z', status: 'open', prospect_name: null, campaign_name: null },
  audit: { id: 1, event_type: 'campaign.created', entity_type: 'campaign', entity_id: '1', display_name: null, created_at: '2026-10-02T12:00:00Z' },
}
