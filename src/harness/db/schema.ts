// Two purposes, kept structurally separate per the spec: the audit tables
// are a passive, complete historical record for human review — harness
// never reads them back. approved_patterns is the opposite: a small table
// harness actively queries at runtime to decide whether to skip the
// approval gate. They live in the same file (one db connection, one file
// to gitignore) but are never queried through the same code path.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT,
  total_iterations INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  total_tokens_used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tool_call_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_call_attempt_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  decision TEXT NOT NULL,
  matched_pattern_id INTEGER
);

CREATE TABLE IF NOT EXISTS denylist_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  tool_call_attempt_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  blocked INTEGER NOT NULL,
  matched_rule TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  trigger TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  checkpoint_trigger TEXT NOT NULL,
  passed INTEGER NOT NULL,
  output_summary TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS rollbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  reverted_to_snapshot_id INTEGER,
  triggered_by_validation_id INTEGER,
  triggered_by TEXT NOT NULL DEFAULT 'validation_failure'
);

CREATE TABLE IF NOT EXISTS approved_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  approval_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tool_name, normalized_key)
);
`;
