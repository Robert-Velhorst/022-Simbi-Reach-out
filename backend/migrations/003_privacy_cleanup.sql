CREATE TABLE privacy_cleanup_plans (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  receipt_json TEXT
);
CREATE INDEX idx_privacy_cleanup_workspace ON privacy_cleanup_plans(workspace_id, owner_id);
