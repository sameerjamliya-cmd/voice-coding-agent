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
  return db;
}
