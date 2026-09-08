import type { DatabaseSync } from "node:sqlite";

// Small, fast-access table harness actively queries at runtime — the
// opposite of the history log. Conceptually a projection of every
// user_approved decision in approval_decisions, but physically separate
// and optimized for a single lookup per gated tool call, not for
// historical completeness.
export class ApprovedPatternsStore {
  constructor(private db: DatabaseSync) {}

  find(toolName: string, normalizedKey: string): { id: number } | null {
    const row = this.db
      .prepare(`SELECT id FROM approved_patterns WHERE tool_name = ? AND normalized_key = ?`)
      .get(toolName, normalizedKey) as { id: number } | undefined;
    return row ? { id: row.id } : null;
  }

  recordUse(id: number): void {
    this.db
      .prepare(`UPDATE approved_patterns SET last_used_at = ?, approval_count = approval_count + 1 WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  approve(toolName: string, normalizedKey: string): number {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO approved_patterns (tool_name, normalized_key, created_at, last_used_at, approval_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(tool_name, normalized_key)
         DO UPDATE SET last_used_at = excluded.last_used_at, approval_count = approval_count + 1`
      )
      .run(toolName, normalizedKey, timestamp, timestamp);
    return this.find(toolName, normalizedKey)!.id;
  }
}
