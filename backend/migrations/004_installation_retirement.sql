-- A retired personal installation cannot silently bootstrap without its safety history.
-- The receipt contains counts/timestamps and a backup basename, not account content.
CREATE TABLE installation_retirement (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  receipt_json TEXT NOT NULL
);
