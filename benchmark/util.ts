import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// Shared low-level helpers used by tasks.ts (in its `check` functions) and
// runner.ts (setting up each task's temp repo). Kept out of tasks.ts itself
// so the task definitions stay readable as "what does this task actually
// test", not buried in git/sqlite plumbing.

export async function writeFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
}

export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

export function initGitRepo(cwd: string): void {
  git(["init", "-q"], cwd);
  git(["config", "user.email", "benchmark@local.test"], cwd);
  git(["config", "user.name", "Benchmark Runner"], cwd);
}

// Commits everything currently in the working tree and returns the new
// commit sha — used once right after task.setup() to fix the "before the
// agent touched anything" baseline that check functions diff against.
export function commitAll(cwd: string, message: string): string {
  git(["add", "-A"], cwd);
  // --allow-empty so a task with no seed files (multi-file-feature starts
  // from an empty project) still gets a real baseline commit to diff from.
  git(["commit", "-q", "--allow-empty", "-m", message], cwd);
  return git(["rev-parse", "HEAD"], cwd);
}

// Stages whatever the agent left behind (committed or not — the harness
// commits before each undo-eligible call, not necessarily after the last
// one) and diffs it against the pre-task baseline, so callers see the full,
// final picture of what changed regardless of the harness's own commit
// granularity.
export function finalDiff(cwd: string, baselineSha: string): string {
  git(["add", "-A"], cwd);
  try {
    return git(["diff", "--cached", baselineSha], cwd);
  } catch {
    return "";
  }
}

export function changedFiles(cwd: string, baselineSha: string): string[] {
  git(["add", "-A"], cwd);
  const out = git(["diff", "--cached", "--name-only", baselineSha], cwd);
  return out ? out.split("\n").filter(Boolean) : [];
}

export interface ToolCallAttemptRow {
  id: number;
  session_id: string;
  timestamp: string;
  tool_name: string;
  input_json: string;
  source_server: string | null;
}

export function toolCallAttempts(db: DatabaseSync, sessionId: string): ToolCallAttemptRow[] {
  return db
    .prepare(`SELECT * FROM tool_call_attempts WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as unknown as ToolCallAttemptRow[];
}

export interface DenylistCheckRow {
  id: number;
  matched: number;
  matched_rule: string | null;
  escalation_decision: string | null;
}

export function denylistChecks(db: DatabaseSync, sessionId: string): DenylistCheckRow[] {
  return db
    .prepare(`SELECT * FROM denylist_checks WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as unknown as DenylistCheckRow[];
}

export function latestValidationSummary(db: DatabaseSync, sessionId: string): string | null {
  const row = db
    .prepare(`SELECT summary FROM validations WHERE session_id = ? ORDER BY id DESC LIMIT 1`)
    .get(sessionId) as { summary: string } | undefined;
  return row?.summary ?? null;
}

// Runs a Node script inside the temp repo and reports pass/fail without
// throwing — a failing test run is an expected, checkable outcome here, not
// an exceptional one.
export function runNodeScript(cwd: string, relPath: string): { pass: boolean; output: string } {
  try {
    const output = execFileSync("node", [relPath], { cwd, encoding: "utf-8", stdio: "pipe" });
    return { pass: true, output };
  } catch (err: any) {
    return { pass: false, output: `${err.stdout ?? ""}${err.stderr ?? err.message ?? ""}` };
  }
}

const MUTATING_TOOL_NAMES = new Set(["write_file", "edit_file", "delete_file", "move_file", "create_directory", "run_command"]);

export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOL_NAMES.has(toolName);
}

const ORIENTATION_TOOL_NAMES = new Set([
  "list_directory",
  "read_file",
  "read_multiple_files",
  "search_files",
  "get_file_outline",
  "get_file_stats",
  "git_status",
  "git_log",
  "git_diff",
  "git_blame",
  "read_package_manifest",
  "list_installed_packages",
]);

export function isOrientationTool(toolName: string): boolean {
  return ORIENTATION_TOOL_NAMES.has(toolName);
}
