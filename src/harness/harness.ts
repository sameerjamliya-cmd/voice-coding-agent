import type { DatabaseSync } from "node:sqlite";
import type { CheckpointResult, SessionEndStatus, ToolExecutor, ToolResult } from "../agent/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { confirm, prompt } from "../shared/terminal-prompt.js";
import { checkDenylist } from "./denylist.js";
import { GitSnapshotManager } from "./snapshot.js";
import { normalizeToolCall } from "./normalize.js";
import { openHarnessDb } from "./db/connection.js";
import { HistoryLog } from "./db/history.js";
import { ApprovedPatternsStore } from "./db/approved-patterns.js";

const MUTATING_TOOLS = new Set(["write_file", "edit_file", "delete_file", "move_file", "create_directory"]);
const GATED_TOOLS = new Set([...MUTATING_TOOLS, "run_command"]);

export type HarnessEvent =
  | { type: "denylist_block"; command: string; reason: string }
  | { type: "checkpoint_running" }
  | { type: "checkpoint_skipped"; reason: string }
  | { type: "checkpoint_passed" }
  | { type: "checkpoint_failed"; output: string }
  | { type: "rollback"; sha: string };

export interface HarnessOptions {
  task: string;
  cwd?: string;
  onEvent?: (event: HarnessEvent) => void;
}

// Sits between the loop's decision to call a tool and the tool actually
// running: gate -> snapshot -> sandbox check -> run -> validate at
// checkpoints -> rollback if needed. Wraps a ToolRegistry; doesn't replace
// it, and tools themselves don't change. Every decision point also writes
// to two separate SQLite-backed stores: a passive history log (audit
// trail, never read back) and a small approved-patterns table (actively
// queried to decide whether to skip the approval prompt).
export class Harness implements ToolExecutor {
  private registry: ToolRegistry;
  private cwd: string;
  private snapshots: GitSnapshotManager;
  private onEvent?: (event: HarnessEvent) => void;

  private db: DatabaseSync;
  private history: HistoryLog;
  private patterns: ApprovedPatternsStore;
  private taskSnapshotDbId: number | null = null;

  constructor(registry: ToolRegistry, options: HarnessOptions) {
    this.registry = registry;
    this.cwd = options.cwd ?? ".";
    this.snapshots = new GitSnapshotManager(this.cwd);
    this.onEvent = options.onEvent;

    this.db = openHarnessDb(this.cwd);
    this.history = new HistoryLog(this.db, options.task);
    this.patterns = new ApprovedPatternsStore(this.db);
  }

  async execute(name: string, input: any): Promise<ToolResult> {
    const attemptId = this.history.recordToolCallAttempt(name, input);

    if (name === "run_command" && typeof input?.command === "string") {
      const reason = checkDenylist(input.command);
      this.history.recordDenylistCheck(attemptId, Boolean(reason), reason);
      if (reason) {
        this.onEvent?.({ type: "denylist_block", command: input.command, reason });
        return { error: `Blocked by harness denylist (${reason}): "${input.command}"` };
      }
    }

    if (!GATED_TOOLS.has(name)) {
      return this.registry.execute(name, input);
    }

    const hadSnapshot = this.snapshots.hasSnapshot();
    const readiness = await this.snapshots.ensureReadyForMutation(confirm);
    if (!readiness.ok) {
      return { error: readiness.reason ?? "Harness blocked this call." };
    }
    if (!hadSnapshot && this.snapshots.hasSnapshot()) {
      this.taskSnapshotDbId = this.history.recordSnapshot(this.snapshots.getSnapshotSha()!, "task_start");
    }

    const normalizedKey = normalizeToolCall(name, input, this.cwd);
    const match = this.patterns.find(name, normalizedKey);

    if (match) {
      this.patterns.recordUse(match.id);
      this.history.recordApprovalDecision(attemptId, "auto_approved", match.id);
    } else {
      const approved = await confirm(`\nApprove ${name}(${JSON.stringify(input)})?`);
      if (!approved) {
        this.history.recordApprovalDecision(attemptId, "user_denied", null);
        return { error: `User declined to approve "${name}".` };
      }
      const patternId = this.patterns.approve(name, normalizedKey);
      this.history.recordApprovalDecision(attemptId, "user_approved", patternId);
    }

    return this.registry.execute(name, input);
  }

  async checkpoint(task: string): Promise<CheckpointResult> {
    if (!this.snapshots.hasSnapshot()) {
      // No mutating/run_command call happened this task — nothing changed,
      // nothing to validate.
      return { action: "done" };
    }

    this.onEvent?.({ type: "checkpoint_running" });
    const startedAt = Date.now();
    const result = await this.registry.execute("run_tests", { cwd: this.cwd });
    const durationMs = Date.now() - startedAt;

    const isUnconfigured =
      Boolean(result.error) &&
      (/No "test" script found/.test(result.error!) || /ENOENT.*package\.json/.test(result.error!));
    if (isUnconfigured) {
      this.onEvent?.({ type: "checkpoint_skipped", reason: result.error! });
      return { action: "done" };
    }

    const passed = !result.error;
    const outputSummary = (passed ? result.output : result.error) ?? "";
    const validationId = this.history.recordValidation("stop_reason", passed, outputSummary.slice(0, 4000), durationMs);

    if (passed) {
      this.onEvent?.({ type: "checkpoint_passed" });
      return { action: "done" };
    }

    this.onEvent?.({ type: "checkpoint_failed", output: result.error! });

    const sha = this.snapshots.getSnapshotSha() ?? "";
    await this.snapshots.rollback();
    this.history.recordRollback(this.taskSnapshotDbId, validationId);
    this.onEvent?.({ type: "rollback", sha });

    const answer = await prompt(
      `\nValidation failed at checkpoint. Changes were rolled back to the pre-task snapshot (${sha.slice(0, 8)}).\n\n` +
        `Test output:\n${result.error}\n\n` +
        `What should happen next? (e.g. retry with a fix, abandon, or inspect manually)\n> `
    );

    return {
      action: "continue",
      message:
        `Validation failed and changes were rolled back to the pre-task snapshot.\n\n` +
        `Test output:\n${result.error}\n\n` +
        `User direction: ${answer}`,
    };
  }

  recordIteration(): void {
    this.history.recordIteration();
  }

  endSession(status: SessionEndStatus): void {
    this.history.endSession(status);
    this.db.close();
  }
}
