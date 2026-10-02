-- Additive, forward-only retry tombstones. No private request or response copies.
-- Recover an older release only by restoring its complete pre-upgrade backup.
CREATE TABLE core_creation_receipts (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL CHECK(length(key_hash) = 64),
  operation TEXT NOT NULL CHECK(operation IN ('campaigns','prospects','templates','drafts','replies','prospects/import')),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  result_hash TEXT NOT NULL CHECK(length(result_hash) = 64),
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  prospect_id INTEGER REFERENCES prospects(id) ON DELETE SET NULL,
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  draft_id INTEGER REFERENCES drafts(id) ON DELETE SET NULL,
  reply_id INTEGER REFERENCES replies(id) ON DELETE SET NULL,
  audit_id INTEGER REFERENCES audit_events(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, actor_user_id, key_hash),
  CHECK((campaign_id IS NOT NULL)+(prospect_id IS NOT NULL)+(template_id IS NOT NULL)+
        (draft_id IS NOT NULL)+(reply_id IS NOT NULL)+(audit_id IS NOT NULL) <= 1),
  CHECK((campaign_id IS NULL OR operation='campaigns') AND
        (prospect_id IS NULL OR operation='prospects') AND
        (template_id IS NULL OR operation='templates') AND
        (draft_id IS NULL OR operation='drafts') AND
        (reply_id IS NULL OR operation='replies') AND
        (audit_id IS NULL OR operation='prospects/import'))
);
CREATE INDEX idx_core_receipt_campaign_id ON core_creation_receipts(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_core_receipt_prospect_id ON core_creation_receipts(prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX idx_core_receipt_template_id ON core_creation_receipts(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX idx_core_receipt_draft_id ON core_creation_receipts(draft_id) WHERE draft_id IS NOT NULL;
CREATE INDEX idx_core_receipt_reply_id ON core_creation_receipts(reply_id) WHERE reply_id IS NOT NULL;
CREATE INDEX idx_core_receipt_audit_id ON core_creation_receipts(audit_id) WHERE audit_id IS NOT NULL;
CREATE TRIGGER core_receipt_workspace_insert
BEFORE INSERT ON core_creation_receipts
WHEN (NEW.campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND workspace_id=NEW.workspace_id))
 OR (NEW.prospect_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospects WHERE id=NEW.prospect_id AND workspace_id=NEW.workspace_id))
 OR (NEW.template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM templates WHERE id=NEW.template_id AND workspace_id=NEW.workspace_id))
 OR (NEW.draft_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM drafts WHERE id=NEW.draft_id AND workspace_id=NEW.workspace_id))
 OR (NEW.reply_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM replies WHERE id=NEW.reply_id AND workspace_id=NEW.workspace_id))
 OR (NEW.audit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_events WHERE id=NEW.audit_id AND workspace_id=NEW.workspace_id))
BEGIN
  SELECT RAISE(ABORT, 'Creation receipt workspace mismatch');
END;
CREATE TRIGGER core_receipt_workspace_update
BEFORE UPDATE OF workspace_id,campaign_id,prospect_id,template_id,draft_id,reply_id,audit_id ON core_creation_receipts
WHEN (NEW.campaign_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id=NEW.campaign_id AND workspace_id=NEW.workspace_id))
 OR (NEW.prospect_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospects WHERE id=NEW.prospect_id AND workspace_id=NEW.workspace_id))
 OR (NEW.template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM templates WHERE id=NEW.template_id AND workspace_id=NEW.workspace_id))
 OR (NEW.draft_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM drafts WHERE id=NEW.draft_id AND workspace_id=NEW.workspace_id))
 OR (NEW.reply_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM replies WHERE id=NEW.reply_id AND workspace_id=NEW.workspace_id))
 OR (NEW.audit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_events WHERE id=NEW.audit_id AND workspace_id=NEW.workspace_id))
BEGIN
  SELECT RAISE(ABORT, 'Creation receipt workspace mismatch');
END;
