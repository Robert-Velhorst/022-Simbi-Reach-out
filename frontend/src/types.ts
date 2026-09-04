export type Member = {
  user_id: number
  email: string
  display_name: string
  workspace_id: number
  workspace_name: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  mode: 'assisted' | 'demo'
  compliance_ack_at: string | null
  paused_at: string | null
  environment: string
  demo_mode: boolean
}

export type Page<T> = { items: T[]; total: number; limit: number; offset: number }

export type Campaign = {
  id: number
  name: string
  description: string
  purpose: string
  lawful_basis: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  daily_limit: number
  cooldown_minutes: number
  total?: number
  reviewed?: number
}

export type Prospect = {
  id: number
  name: string
  organization: string
  provider: string
  source_url: string
  contact_handle: string
  notes: string
  consent_status: 'unknown' | 'contextual' | 'consented' | 'opted_out' | 'blocked'
  created_at: string
}

export type Template = {
  id: number
  name: string
  provider: string
  subject: string
  body: string
  version: number
}

export type Draft = {
  content_hash: string
  id: number
  campaign_id: number
  prospect_id: number
  template_id: number
  prospect_name: string
  organization: string
  source_url: string
  consent_status: string
  campaign_name: string
  template_name: string
  subject: string
  body: string
  state: string
  quality_score: number
  safety_flags: string[]
  updated_at: string
}

export type Reminder = {
  id: number
  title: string
  due_at: string
  status: string
  prospect_name: string | null
  campaign_name: string | null
}

export type AuditEvent = {
  id: number
  event_type: string
  entity_type: string
  entity_id: string
  display_name: string | null
  created_at: string
}
