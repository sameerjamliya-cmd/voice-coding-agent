import type { DatabaseSync } from "node:sqlite";
import type { CheckpointResult, SessionEndStatus, TokenBudgetResult, ToolExecutor, ToolResult } from "../agent/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { choice, confirm } from "../shared/terminal-prompt.js";
import { checkDenylist } from "./denylist.js";
import { GitSnapshotManager } from "./snapshot.js";
import { normalizeToolCall } from "./normalize.js";
import { buildApprovalPreview } from "./diff-preview.js";
import { loadHarnessConfig, type HarnessConfig, type HarnessConfigOverrides } from "./config.js";
import { openHarnessDb } from "./db/connection.js";
import { HistoryLog } from "./db/history.js";
import { ApprovedPatternsStore } from "./db/approved-patterns.js";

const MUTATING_TOOLS = new Set(["write_file", "edit_file", "delete_file", "move_file", "create_directory"]);
const GATED_TOOLS = new Set([...MUTATING_TOOLS, "run_command"]);

// Only these four produce their own individually-undoable snapshot — see
// PHASE_2_ENHANCEMENTS.md section 4. run_command and create_directory are
// still gated and still covered by the task-level rollback-on-validation-
// failure, just not by `agent undo`'s one-step-at-a-time granularity.
const UNDO_TRACKED_TOOLS = new Set(["write_file", "edit_file", "delete_file", "move_file"]);

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
  configOverrides?: HarnessConfigOverrides;
}

// Sits between the loop's decision to call a tool and the tool actually
// running: gate -> snapshot -> sandbox check -> run -> validate at
// checkpoints -> rollback if needed. Wraps a ToolRegistry; doesn't replace
// it, and tools themselves don't change.
export class Harness implements ToolExecutor {
  private registry: ToolRegistry;
  private cwd: string;
  private snapshots: GitSnapshotManager;
  private onEvent?: (event: HarnessEvent) => void;
  private task: string;

  private db: DatabaseSync;
  private history: HistoryLog;
  private patterns: ApprovedPatternsStore;
  private taskSnapshotDbId: number | null = null;

  private config: HarnessConfig;
  private cumulativeTokens = 0;
  private sessionBudget: number | undefined;
  private budgetAcknowledged = false;

  static async create(registry: ToolRegistry, options: HarnessOptions): Promise<Harness> {
    const config = await loadHarnessConfig(options.cwd ?? ".", options.configOverrides);
    return new Harness(registry, options, config);
  }

  private constructor(registry: ToolRegistry, options: HarnessOptions, config: HarnessConfig) {
    this.registry = registry;
    this.cwd = options.cwd ?? ".";
    this.task = options.task;
    this.snapshots = new GitSnapshotManager(this.cwd);
    this.onEvent = options.onEvent;
    this.config = config;
    this.sessionBudget = config.tokenBudget;

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
      this.taskSnapshotDbId = this.history.recordSnapshot(
        this.snapshots.getSnapshotSha()!,
        "task_start",
        "task start baseline"
      );
    }

    const normalizedKey = normalizeToolCall(name, input, this.cwd);
    const match = this.patterns.find(name, normalizedKey);

    if (match) {
      this.patterns.recordUse(match.id);
      this.history.recordApprovalDecision(attemptId, "auto_approved", match.id);
    } else {
      // Only the manual-approval path shows a preview — an auto-approved
      // call skips it entirely, keeping that path fully low-friction.
      const preview = await buildApprovalPreview(name, input, this.cwd);
      if (preview) console.log(`\n${preview}`);

      const approved = await confirm(`\nApprove ${name}(${JSON.stringify(input)})?`);
      if (!approved) {
        this.history.recordApprovalDecision(attemptId, "user_denied", null);
        return { error: `User declined to approve "${name}".` };
      }
      const patternId = this.patterns.approve(name, normalizedKey);
      this.history.recordApprovalDecision(attemptId, "user_approved", patternId);
    }

    if (UNDO_TRACKED_TOOLS.has(name)) {
      const { sha, created } = await this.snapshots.snapshotBeforeCall(describeCall(name, input));
      if (created) {
        this.history.recordSnapshot(sha, "pre_mutation", describeCall(name, input));
      }
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
    this.history.recordRollback(this.taskSnapshotDbId, validationId, "validation_failure");
    this.onEvent?.({ type: "rollback", sha });

    const answer = await choice(
      `Validation failed at checkpoint. Changes were rolled back to the pre-task snapshot (${sha.slice(0, 8)}).\n\n` +
        `Test output:\n${result.error}`,
      ["Retry", "Abandon", "Inspect it myself"]
    );

    return {
      action: "continue",
      message:
        `Validation failed and changes were rolled back to the pre-task snapshot.\n\n` +
        `Test output:\n${result.error}\n\n` +
        `User direction: ${answer}`,
    };
  }

  async checkTokenBudget(usage: { inputTokens: number; outputTokens: number }): Promise<TokenBudgetResult> {
    this.cumulativeTokens += usage.inputTokens + usage.outputTokens;
    this.history.recordTokenUsage(this.cumulativeTokens);

    if (this.sessionBudget == null) {
      return { action: "continue" };
    }

    const hardCeiling = this.sessionBudget * this.config.hardCeilingMultiplier;
    if (this.cumulativeTokens >= hardCeiling) {
      return {
        action: "stop",
        message:
          `Stopped: cumulative token usage (${this.cumulativeTokens}) reached the hard ceiling ` +
          `(${hardCeiling}, ${this.config.hardCeilingMultiplier}x the configured budget of ${this.sessionBudget}). ` +
          `Stopping automatically as a backstop rather than waiting indefinitely.`,
      };
    }

    if (this.cumulativeTokens < this.sessionBudget || this.budgetAcknowledged) {
      return { action: "continue" };
    }

    const answer = await choice(
      `This task has used ${this.cumulativeTokens} / ${this.sessionBudget} tokens so far.`,
      ["Continue", "Stop here", "Raise the limit for this task"]
    );

    if (answer === "Stop here") {
      return {
        action: "stop",
        message: `User chose to stop after the task crossed its token budget (${this.cumulativeTokens} / ${this.sessionBudget}).`,
      };
    }

    if (answer === "Raise the limit for this task") {
      const { prompt } = await import("../shared/terminal-prompt.js");
      const raw = await prompt(`New token budget for the rest of this task (current: ${this.sessionBudget}): `);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > this.sessionBudget) {
        this.sessionBudget = parsed;
        return { action: "continue" };
      }
      console.log("Invalid or non-increasing value — keeping the current budget.");
    }

    this.budgetAcknowledged = true;
    return { action: "continue" };
  }

  recordIteration(): void {
    this.history.recordIteration();
  }

  async endSession(status: SessionEndStatus): Promise<void> {
    await this.snapshots.finalizeSession(this.task);
    this.history.endSession(status);
    this.db.close();
  }
}

function describeCall(name: string, input: any): string {
  switch (name) {
    case "write_file":
    case "edit_file":
    case "delete_file":
      return `${name} on ${input?.path ?? "?"}`;
    case "move_file":
      return `move_file: ${input?.from ?? "?"} -> ${input?.to ?? "?"}`;
    default:
      return name;
  }
}
