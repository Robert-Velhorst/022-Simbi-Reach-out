PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'assisted' CHECK(mode IN ('assisted', 'demo')),
  compliance_ack_at TEXT,
  compliance_ack_by INTEGER REFERENCES users(id),
  paused_at TEXT,
  paused_by INTEGER REFERENCES users(id),
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK(retention_days BETWEEN 30 AND 3650),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
  PRIMARY KEY(user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL,
  lawful_basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'archived')),
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK(daily_limit BETWEEN 1 AND 50),
  cooldown_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(cooldown_minutes BETWEEN 60 AND 43200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'simbi',
  source_url TEXT NOT NULL,
  contact_handle TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK(consent_status IN ('unknown', 'contextual', 'consented', 'opted_out', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, provider, source_url)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'simbi',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'needs_review' CHECK(state IN ('needs_review', 'approved', 'handoff_created', 'sent', 'ambiguous', 'replied', 'declined', 'suppressed')),
  quality_score INTEGER NOT NULL CHECK(quality_score BETWEEN 0 AND 100),
  safety_flags TEXT NOT NULL DEFAULT '[]',
  reviewed_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id, prospect_id)
);

CREATE TABLE IF NOT EXISTS handoffs (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  provider_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared', 'opened', 'sent', 'cancelled', 'ambiguous')),
  prepared_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound', 'outbound_note')),
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  prospect_id INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'cancelled')),
  created_by TEXT NOT NULL CHECK(created_by IN ('user', 'worker')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_id INTEGER REFERENCES prospects(id) ON DELETE SET NULL,
  normalized_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, normalized_value)
);

CREATE TABLE IF NOT EXISTS provider_settings (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'assisted' CHECK(mode = 'assisted'),
  verified_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS feature_flags (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_status ON campaigns(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_prospects_workspace_name ON prospects(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_drafts_workspace_state ON drafts(workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_drafts_campaign ON drafts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_draft ON handoffs(draft_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(workspace_id, created_at DESC);
