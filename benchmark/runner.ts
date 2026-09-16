import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runLoop } from "../src/agent/loop.js";
import { Harness } from "../src/harness/harness.js";
import { buildRegistry } from "../src/tools/build-registry.js";
import { loadSkills } from "../src/skills/registry.js";
import { selectProvider } from "../src/llm/select-provider.js";
import { setBenchmarkAutoApprove } from "../src/shared/terminal-prompt.js";
import type { Skill } from "../src/skills/types.js";
import { writeFile } from "node:fs/promises";
import { TASKS, type BenchmarkTask } from "./tasks.js";
import { initGitRepo, commitAll, finalDiff, latestValidationSummary } from "./util.js";

// Written into every task's temp repo before the baseline commit — without
// it, a task whose prompt leads the agent to run `npm install` (a
// realistic, legitimate thing for it to do) fills the git diff with
// thousands of node_modules files. That diff still "works" mechanically
// but is useless input to the judge pass (a 400KB+ diff dominated by
// machine-generated code buries the ~30 lines that actually matter, and
// the judge reliably misreads it as "no changes were made" — this was
// caught by inspecting an actual benchmark run, not a hypothetical).
const DEFAULT_GITIGNORE = `node_modules/\ndist/\nbuild/\n*.log\n`;

export interface TaskRunResult {
  taskId: string;
  category: string;
  tempDir: string;
  sessionId: string | null;
  finalText: string;
  wallTimeMs: number;
  totalTokens: number;
  totalIterations: number;
  sessionStatus: string | null;
  benchmarkModeConfirmed: boolean;
  mechanicalPass: boolean;
  mechanicalDetails: string;
  baselineSha: string | null;
  // Captured before temp-dir cleanup so judge.ts/report.ts can use them
  // regardless of the configured PreservePolicy.
  diff: string;
  markTaskCompleteSummary: string | null;
  runError?: string;
}

// "always" | "on-failure" (default) | "never" — matches the spec's "clean
// up afterward (or preserve it on failure for inspection — make this
// configurable)".
type PreservePolicy = "always" | "on-failure" | "never";

function getPreservePolicy(): PreservePolicy {
  const raw = process.env.BENCHMARK_PRESERVE_TEMP_DIRS;
  if (raw === "always" || raw === "never") return raw;
  return "on-failure";
}

async function runSingleTask(task: BenchmarkTask, skills: Skill[]): Promise<TaskRunResult> {
  const tempDir = await mkdtemp(join(tmpdir(), `agent-benchmark-${task.id}-`));
  const startedAt = Date.now();
  let sessionId: string | null = null;
  let baselineSha: string | null = null;
  // Tool implementations (read_file/write_file/edit_file/run_command/...)
  // resolve relative paths against process.cwd(), not against Harness's
  // `cwd` option — that option only scopes git/config (see write-file.ts's
  // own comment on this). The real CLI never notices because each
  // invocation is already a fresh process launched inside the target
  // directory. This runner is one long-lived process driving many tasks
  // against many different temp directories in sequence, so without an
  // explicit chdir, an agent tool call using a relative path would resolve
  // against wherever this benchmark process itself was started from — the
  // real project checkout — not the disposable sandbox. Every task run is
  // therefore wrapped in a chdir into its own tempDir and back out,
  // regardless of how it ends.
  const originalCwd = process.cwd();

  try {
    process.chdir(tempDir);
    initGitRepo(tempDir);
    await writeFile(join(tempDir, ".gitignore"), DEFAULT_GITIGNORE, "utf-8");
    await task.setup(tempDir);
    baselineSha = commitAll(tempDir, "benchmark: seed fixture");

    // Opt-in, and scoped to exactly this disposable temp directory for the
    // duration of this one task run — see terminal-prompt.ts for what this
    // actually changes (every confirm/choice/prompt call resolves
    // immediately with a conservative default instead of blocking on
    // stdin). Reset in `finally` below regardless of outcome.
    setBenchmarkAutoApprove(true);

    const registry = buildRegistry(skills, []);
    const provider = selectProvider();
    const harness = await Harness.create(registry, {
      task: task.prompt,
      cwd: tempDir,
      benchmarkMode: true,
    });
    sessionId = harness.sessionId;

    const finalText = await runLoop({
      task: task.prompt,
      registry,
      provider,
      harness,
      skills,
      maxIterations: 25,
    });

    const wallTimeMs = Date.now() - startedAt;

    const db = new DatabaseSync(join(tempDir, ".voice-agent", "harness.db"));
    try {
      const sessionRow = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
        | { status: string | null; total_tokens_used: number; total_iterations: number; benchmark_mode: number }
        | undefined;

      if (!sessionRow) {
        throw new Error(`No session row found for session id ${sessionId} — observability logging may be broken.`);
      }

      const mechanical = await task.check({ tempDir, db, sessionId, finalText, baselineSha });
      const diff = finalDiff(tempDir, baselineSha);
      const markTaskCompleteSummary = latestValidationSummary(db, sessionId);

      return {
        taskId: task.id,
        category: task.category,
        tempDir,
        sessionId,
        finalText,
        wallTimeMs,
        totalTokens: sessionRow.total_tokens_used,
        totalIterations: sessionRow.total_iterations,
        sessionStatus: sessionRow.status,
        benchmarkModeConfirmed: sessionRow.benchmark_mode === 1,
        mechanicalPass: mechanical.pass,
        mechanicalDetails: mechanical.details,
        baselineSha,
        diff,
        markTaskCompleteSummary,
      };
    } finally {
      db.close();
    }
  } catch (err: any) {
    return {
      taskId: task.id,
      category: task.category,
      tempDir,
      sessionId,
      finalText: "",
      wallTimeMs: Date.now() - startedAt,
      totalTokens: 0,
      totalIterations: 0,
      sessionStatus: null,
      benchmarkModeConfirmed: false,
      mechanicalPass: false,
      mechanicalDetails: `Task run threw before a check could complete: ${err.message}`,
      baselineSha,
      diff: "",
      markTaskCompleteSummary: null,
      runError: err.message,
    };
  } finally {
    // Cleanup is centralized in runAllTasks(), which sees the full result
    // (including pass/fail) and decides against the configured
    // PreservePolicy — this function only ever resets the auto-approve
    // flag and the process's cwd, regardless of how the run above ended.
    setBenchmarkAutoApprove(false);
    process.chdir(originalCwd);
  }
}

export async function runAllTasks(taskIds?: string[]): Promise<TaskRunResult[]> {
  process.env.BENCHMARK_MODE = "true";
  const skills = await loadSkills();
  const tasks = taskIds ? TASKS.filter((t) => taskIds.includes(t.id)) : TASKS;

  const results: TaskRunResult[] = [];
  for (const task of tasks) {
    console.log(`\n[benchmark] running "${task.id}"...`);
    const result = await runSingleTask(task, skills);
    console.log(
      `[benchmark] "${task.id}": ${result.mechanicalPass ? "PASS" : "FAIL"} ` +
        `(${result.totalIterations} iterations, ${result.totalTokens} tokens, ${(result.wallTimeMs / 1000).toFixed(1)}s)` +
        (result.runError ? ` — error: ${result.runError}` : "")
    );
    results.push(result);

    const policy = getPreservePolicy();
    const shouldDelete = policy === "never" || (policy === "on-failure" && result.mechanicalPass);
    if (shouldDelete) {
      await rm(result.tempDir, { recursive: true, force: true }).catch(() => {});
    } else {
      console.log(`[benchmark] preserved temp dir for inspection: ${result.tempDir}`);
    }
  }

  return results;
}
