import "dotenv/config";
import { runAllTasks } from "./runner.js";
import { TASKS } from "./tasks.js";
import { judgeTask } from "./judge.js";
import { generateReport, type TaskReportEntry } from "./report.js";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      "Error: neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set. The benchmark runs real agent tasks against " +
        "a real LLM API (and calls it again for the judge pass) — this costs real tokens and takes real time. " +
        "Set one of the keys and re-run. ANTHROPIC_API_KEY is preferred (matches the spec's \"real Claude API\") " +
        "— OPENAI_API_KEY is used for both agent execution and judging only as a fallback when that's all that's available."
    );
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "[benchmark] ANTHROPIC_API_KEY not set — running agent execution AND the judge pass on OpenAI " +
        `(${process.env.OPENAI_MODEL ?? "gpt-4o"}) instead of Claude.`
    );
  }

  const requestedIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const taskIds = requestedIds.length > 0 ? requestedIds : undefined;
  if (taskIds) {
    const known = new Set(TASKS.map((t) => t.id));
    const unknown = taskIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      console.error(`Unknown task id(s): ${unknown.join(", ")}\nKnown ids: ${[...known].join(", ")}`);
      process.exit(1);
    }
  }

  console.log(
    `[benchmark] starting ${taskIds ? taskIds.length : TASKS.length} task(s) against the real API. ` +
      `Preserve policy: ${process.env.BENCHMARK_PRESERVE_TEMP_DIRS ?? "on-failure"} (see README).`
  );

  const results = await runAllTasks(taskIds);
  const taskById = new Map(TASKS.map((t) => [t.id, t]));

  const entries: TaskReportEntry[] = [];
  for (const result of results) {
    const task = taskById.get(result.taskId);
    const needsJudge = task?.needsJudge ?? true;

    if (!needsJudge || result.runError) {
      entries.push({ result, judge: null });
      continue;
    }

    console.log(`[benchmark] judging "${result.taskId}"...`);
    const judge = await judgeTask(task!.prompt, result.diff, {
      markTaskCompleteSummary: result.markTaskCompleteSummary,
    });
    entries.push({ result, judge });
  }

  const reportPath = await generateReport(entries);
  console.log(`\n[benchmark] report written to ${reportPath}`);

  const passCount = results.filter((r) => r.mechanicalPass).length;
  console.log(`[benchmark] mechanical pass rate: ${passCount}/${results.length}`);

  const benchmarkModeIssues = results.filter((r) => !r.runError && !r.benchmarkModeConfirmed);
  if (benchmarkModeIssues.length > 0) {
    console.error(
      `[benchmark] WARNING: benchmark_mode was not correctly logged for: ${benchmarkModeIssues.map((r) => r.taskId).join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(`[benchmark] fatal error: ${err.stack ?? err.message}`);
  process.exit(1);
});
