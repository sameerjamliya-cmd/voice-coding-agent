import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA } from "./schema.js";

// Approval memory persists per project directory: a .voice-agent/ folder
// alongside the code being worked on, not a global machine-wide store and
// not reset per task. A pattern approved while working in one project
// never silently applies to another.
export function openHarnessDb(cwd: string): DatabaseSync {
  const dir = join(cwd, ".voice-agent");
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "harness.db"));
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// `CREATE TABLE IF NOT EXISTS` above only creates sessions with every
// current column when the table doesn't exist yet — an older on-disk db
// (from before a column was added to SCHEMA) keeps its old shape forever
// otherwise. Each entry here is idempotent and safe to run on every open.
function migrate(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  const hasBenchmarkMode = columns.some((c) => c.name === "benchmark_mode");
  if (!hasBenchmarkMode) {
    db.exec(`ALTER TABLE sessions ADD COLUMN benchmark_mode INTEGER NOT NULL DEFAULT 0`);
  }
}
