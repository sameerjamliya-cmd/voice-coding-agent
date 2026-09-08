import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type ApprovalDecision = "auto_approved" | "user_approved" | "user_denied";
export type SnapshotTrigger = "task_start" | "pre_mutation";
export type SessionStatus = "completed" | "abandoned" | "max_iterations";
export type RollbackTrigger = "validation_failure" | "manual_undo";

// Passive, complete audit trail of every harness decision — written as a
// side effect of the decision itself, never read back by harness to
// change its own behavior. Answering "why was this auto-approved" or
// "what did rollback revert to" should always be possible by querying
// these tables directly.
export class HistoryLog {
  readonly sessionId: string;

  constructor(private db: DatabaseSync, task: string) {
    this.sessionId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO sessions (id, task_description, started_at, status, total_iterations, total_tool_calls)
         VALUES (?, ?, ?, 'in_progress', 0, 0)`
      )
      .run(this.sessionId, task, now());
  }

  endSession(status: SessionStatus): void {
    this.db
      .prepare(`UPDATE sessions SET ended_at = ?, status = ? WHERE id = ?`)
      .run(now(), status, this.sessionId);
  }

  recordIteration(): void {
    this.db
      .prepare(`UPDATE sessions SET total_iterations = total_iterations + 1 WHERE id = ?`)
      .run(this.sessionId);
  }

  recordTokenUsage(cumulativeTotal: number): void {
    this.db
      .prepare(`UPDATE sessions SET total_tokens_used = ? WHERE id = ?`)
      .run(cumulativeTotal, this.sessionId);
  }

  recordToolCallAttempt(toolName: string, input: unknown): number {
    const result = this.db
      .prepare(
        `INSERT INTO tool_call_attempts (session_id, timestamp, tool_name, input_json) VALUES (?, ?, ?, ?)`
      )
      .run(this.sessionId, now(), toolName, JSON.stringify(input));
    this.db
      .prepare(`UPDATE sessions SET total_tool_calls = total_tool_calls + 1 WHERE id = ?`)
      .run(this.sessionId);
    return Number(result.lastInsertRowid);
  }

  recordApprovalDecision(
    toolCallAttemptId: number,
    decision: ApprovalDecision,
    matchedPatternId: number | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO approval_decisions (session_id, tool_call_attempt_id, timestamp, decision, matched_pattern_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(this.sessionId, toolCallAttemptId, now(), decision, matchedPatternId);
  }

  recordDenylistCheck(toolCallAttemptId: number, blocked: boolean, matchedRule: string | null): void {
    this.db
      .prepare(
        `INSERT INTO denylist_checks (session_id, tool_call_attempt_id, timestamp, blocked, matched_rule)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(this.sessionId, toolCallAttemptId, now(), blocked ? 1 : 0, matchedRule);
  }

  recordSnapshot(gitSha: string, trigger: SnapshotTrigger, description: string | null): number {
    const result = this.db
      .prepare(
        `INSERT INTO snapshots (session_id, timestamp, git_sha, trigger, description) VALUES (?, ?, ?, ?, ?)`
      )
      .run(this.sessionId, now(), gitSha, trigger, description);
    return Number(result.lastInsertRowid);
  }

  recordValidation(
    checkpointTrigger: string,
    passed: boolean,
    outputSummary: string,
    durationMs: number
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO validations (session_id, timestamp, checkpoint_trigger, passed, output_summary, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(this.sessionId, now(), checkpointTrigger, passed ? 1 : 0, outputSummary, durationMs);
    return Number(result.lastInsertRowid);
  }

  recordRollback(
    revertedToSnapshotId: number | null,
    triggeredByValidationId: number | null,
    triggeredBy: RollbackTrigger
  ): void {
    this.db
      .prepare(
        `INSERT INTO rollbacks (session_id, timestamp, reverted_to_snapshot_id, triggered_by_validation_id, triggered_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(this.sessionId, now(), revertedToSnapshotId, triggeredByValidationId, triggeredBy);
  }
}

function now(): string {
  return new Date().toISOString();
}
