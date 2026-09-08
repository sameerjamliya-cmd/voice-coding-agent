import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

async function git(args: string, cwd: string) {
  return execAsync(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export interface ReadinessResult {
  ok: boolean;
  reason?: string;
}

// Per-task snapshotting: one commit before the task's mutations begin,
// recorded as a rollback point. Individual mutating calls are NOT committed
// separately — a validation failure at checkpoint reverts the whole task's
// worth of changes via `git reset --hard` to that one commit.
export class GitSnapshotManager {
  private cwd: string;
  private repoReady = false;
  private refused = false;
  private taskSnapshotSha: string | null = null;

  constructor(cwd: string = ".") {
    this.cwd = cwd;
  }

  hasSnapshot(): boolean {
    return this.taskSnapshotSha !== null;
  }

  getSnapshotSha(): string | null {
    return this.taskSnapshotSha;
  }

  async ensureReadyForMutation(confirmFn: (question: string) => Promise<boolean>): Promise<ReadinessResult> {
    if (this.refused) {
      return {
        ok: false,
        reason: "User declined to initialize a git repository; mutating tools are disabled for this session.",
      };
    }

    if (!this.repoReady) {
      const isRepo = await this.isGitRepo();

      if (!isRepo) {
        const proceed = await confirmFn(
          "This directory is not a git repository. Harness requires git for snapshotting and rollback. Initialize one now (git init + baseline commit)?"
        );
        if (!proceed) {
          this.refused = true;
          return {
            ok: false,
            reason: "User declined to initialize a git repository; mutating tools are disabled for this session.",
          };
        }
        await git("init", this.cwd);
        await this.ensureVoiceAgentIgnored();
        await git("add -A", this.cwd);
        // Always produce a commit here (even an empty one) so there is
        // always a HEAD to snapshot from — a fresh repo in an otherwise
        // empty directory would leave nothing to `git add`.
        await git(
          `commit --allow-empty -m ${JSON.stringify("Baseline: initial commit (repository initialized by harness)")}`,
          this.cwd
        );
      } else {
        await this.ensureVoiceAgentIgnored();
        if (await this.isDirty()) {
          // Don't blur the user's own in-progress work into the agent's
          // snapshot history — commit it separately as a labeled baseline.
          await git("add -A", this.cwd);
          await this.commitIfNeeded("Baseline: pre-existing uncommitted changes (not agent-made)");
        }
      }

      this.repoReady = true;
    }

    if (!this.taskSnapshotSha) {
      try {
        const { stdout } = await git("rev-parse HEAD", this.cwd);
        this.taskSnapshotSha = stdout.trim();
      } catch (err: any) {
        return {
          ok: false,
          reason: `Harness could not establish a snapshot point: ${err.message}`,
        };
      }
    }

    return { ok: true };
  }

  async rollback(): Promise<void> {
    if (!this.taskSnapshotSha) return;
    await git(`reset --hard ${this.taskSnapshotSha}`, this.cwd);
    // The working tree is guaranteed clean at snapshot time (pre-existing
    // changes are baseline-committed first), so any untracked files present
    // now were created during this task — `reset --hard` alone leaves them
    // behind, so remove them too for a full revert. Exclude .voice-agent/
    // explicitly rather than relying on the project's own .gitignore —
    // harness must never delete its own database, including its own
    // in-progress session row that endSession() is about to write to.
    await git("clean -fd -e .voice-agent/", this.cwd);
  }

  // Registers .voice-agent/ in .git/info/exclude — a local-only ignore
  // rule, not the tracked .gitignore — so harness's own operational
  // database is never staged by its own `git add -A` calls (which would
  // commit it into the user's history) regardless of whether the project
  // already gitignores it.
  private async ensureVoiceAgentIgnored(): Promise<void> {
    const excludePath = join(this.cwd, ".git", "info", "exclude");
    let existing = "";
    try {
      existing = await readFile(excludePath, "utf-8");
    } catch {
      // .git/info doesn't exist yet — created below.
    }
    if (existing.includes(".voice-agent/")) return;

    await mkdir(join(this.cwd, ".git", "info"), { recursive: true });
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await appendFile(excludePath, `${separator}.voice-agent/\n`);
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      await git("rev-parse --is-inside-work-tree", this.cwd);
      return true;
    } catch {
      return false;
    }
  }

  private async isDirty(): Promise<boolean> {
    const { stdout } = await git("status --porcelain", this.cwd);
    return stdout.trim().length > 0;
  }

  private async commitIfNeeded(message: string): Promise<void> {
    try {
      await git(`commit -m ${JSON.stringify(message)}`, this.cwd);
    } catch (err: any) {
      const output = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
      if (!/nothing to commit/i.test(output)) throw err;
    }
  }
}
