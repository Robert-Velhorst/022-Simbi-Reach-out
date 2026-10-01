-- Keep retry tombstones without copying reminder titles, targets or due dates.
CREATE TABLE reminder_creation_receipts (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL CHECK(length(key_hash) = 64),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  result_hash TEXT NOT NULL CHECK(length(result_hash) = 64),
  reminder_id INTEGER REFERENCES reminders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, actor_user_id, key_hash)
);
CREATE INDEX idx_reminder_receipt_record ON reminder_creation_receipts(reminder_id)
WHERE reminder_id IS NOT NULL;
CREATE TRIGGER reminder_receipt_workspace_insert
BEFORE INSERT ON reminder_creation_receipts
WHEN NEW.reminder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM reminders WHERE id=NEW.reminder_id AND workspace_id=NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'Reminder receipt workspace mismatch');
END;
CREATE TRIGGER reminder_receipt_workspace_update
BEFORE UPDATE OF reminder_id,workspace_id ON reminder_creation_receipts
WHEN NEW.reminder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM reminders WHERE id=NEW.reminder_id AND workspace_id=NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'Reminder receipt workspace mismatch');
END;
