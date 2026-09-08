import { resolve } from "node:path";
import type { CheckpointResult, ToolExecutor, ToolResult } from "../agent/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { confirm, prompt } from "../shared/terminal-prompt.js";
import { checkDenylist } from "./denylist.js";
import { GitSnapshotManager } from "./snapshot.js";

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
  cwd?: string;
  onEvent?: (event: HarnessEvent) => void;
}

// Sits between the loop's decision to call a tool and the tool actually
// running: gate -> snapshot -> sandbox check -> run -> validate at
// checkpoints -> rollback if needed. Wraps a ToolRegistry; doesn't replace
// it, and tools themselves don't change.
export class Harness implements ToolExecutor {
  private registry: ToolRegistry;
  private cwd: string;
  private snapshots: GitSnapshotManager;
  private approvedPatterns = new Set<string>();
  private onEvent?: (event: HarnessEvent) => void;

  constructor(registry: ToolRegistry, options: HarnessOptions = {}) {
    this.registry = registry;
    this.cwd = options.cwd ?? ".";
    this.snapshots = new GitSnapshotManager(this.cwd);
    this.onEvent = options.onEvent;
  }

  async execute(name: string, input: any): Promise<ToolResult> {
    if (name === "run_command" && typeof input?.command === "string") {
      const reason = checkDenylist(input.command);
      if (reason) {
        this.onEvent?.({ type: "denylist_block", command: input.command, reason });
        return { error: `Blocked by harness denylist (${reason}): "${input.command}"` };
      }
    }

    if (!GATED_TOOLS.has(name)) {
      return this.registry.execute(name, input);
    }

    const readiness = await this.snapshots.ensureReadyForMutation(confirm);
    if (!readiness.ok) {
      return { error: readiness.reason ?? "Harness blocked this call." };
    }

    const patternKey = `${name}:${normalizeTarget(name, input, this.cwd)}`;
    if (!this.approvedPatterns.has(patternKey)) {
      const approved = await confirm(`\nApprove ${name}(${JSON.stringify(input)})?`);
      if (!approved) {
        return { error: `User declined to approve "${name}".` };
      }
      this.approvedPatterns.add(patternKey);
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
    const result = await this.registry.execute("run_tests", { cwd: this.cwd });

    if (!result.error) {
      this.onEvent?.({ type: "checkpoint_passed" });
      return { action: "done" };
    }

    if (/No "test" script found/.test(result.error) || /ENOENT.*package\.json/.test(result.error)) {
      this.onEvent?.({ type: "checkpoint_skipped", reason: result.error });
      return { action: "done" };
    }

    this.onEvent?.({ type: "checkpoint_failed", output: result.error });

    const sha = this.snapshots.getSnapshotSha() ?? "";
    await this.snapshots.rollback();
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
}

function normalizeTarget(name: string, input: any, cwd: string): string {
  switch (name) {
    case "write_file":
    case "edit_file":
    case "delete_file":
    case "create_directory":
      return resolve(cwd, input?.path ?? "");
    case "move_file":
      return `${resolve(cwd, input?.from ?? "")}->${resolve(cwd, input?.to ?? "")}`;
    case "run_command":
      // Scoped by directory, not by command text — the denylist is the
      // safety net for what a remembered approval in this directory could
      // let through unprompted.
      return resolve(cwd, input?.cwd ?? ".");
    default:
      return JSON.stringify(input);
  }
}
