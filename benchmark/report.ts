import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRunResult } from "./runner.js";
import type { JudgeResult } from "./judge.js";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

export interface TaskReportEntry {
  result: TaskRunResult;
  judge: JudgeResult | null; // null for tasks that don't need a judge pass
}

function fmtScore(n: number | undefined): string {
  return n === undefined ? "—" : String(n);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function generateReport(entries: TaskReportEntry[]): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(RESULTS_DIR, `${timestamp}.md`);

  const passCount = entries.filter((e) => e.result.mechanicalPass).length;
  const passRate = entries.length > 0 ? ((passCount / entries.length) * 100).toFixed(0) : "0";

  const judged = entries.filter((e) => e.judge?.score);
  const avgCorrectness = avg(judged.map((e) => e.judge!.score!.correctness));
  const avgCodeQuality = avg(judged.map((e) => e.judge!.score!.codeQuality));
  const avgScopeDiscipline = avg(judged.map((e) => e.judge!.score!.scopeDiscipline));

  const lines: string[] = [];
  lines.push(`# Agent benchmark report`);
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- Mechanical pass rate: **${passCount}/${entries.length} (${passRate}%)**`);
  if (judged.length > 0) {
    lines.push(
      `- Average judge scores (${judged.length} judged task${judged.length === 1 ? "" : "s"}): ` +
        `correctness **${avgCorrectness?.toFixed(1)}**, code quality **${avgCodeQuality?.toFixed(1)}**, ` +
        `scope discipline **${avgScopeDiscipline?.toFixed(1)}** (all out of 5)`
    );
  }
  lines.push("");

  lines.push(`## Results`);
  lines.push("");
  lines.push(
    `| Task | Category | Mechanical | Correctness | Code quality | Scope | Iterations | Tokens | Wall time |`
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const { result, judge } of entries) {
    const score = judge?.score;
    lines.push(
      `| ${result.taskId} | ${result.category} | ${result.mechanicalPass ? "✅ PASS" : "❌ FAIL"} | ` +
        `${fmtScore(score?.correctness)} | ${fmtScore(score?.codeQuality)} | ${fmtScore(score?.scopeDiscipline)} | ` +
        `${result.totalIterations} | ${result.totalTokens} | ${(result.wallTimeMs / 1000).toFixed(1)}s |`
    );
  }
  lines.push("");

  lines.push(`## Per-task details`);
  for (const { result, judge } of entries) {
    lines.push("");
    lines.push(`### ${result.taskId}`);
    lines.push("");
    lines.push(`- **Category:** ${result.category}`);
    lines.push(`- **Mechanical check:** ${result.mechanicalPass ? "PASS" : "FAIL"} — ${result.mechanicalDetails}`);
    lines.push(`- **Session status:** ${result.sessionStatus ?? "(unknown)"}`);
    lines.push(`- **benchmark_mode logged:** ${result.benchmarkModeConfirmed ? "yes" : "NO — investigate"}`);
    lines.push(`- **Iterations:** ${result.totalIterations}, **Tokens:** ${result.totalTokens}, **Wall time:** ${(result.wallTimeMs / 1000).toFixed(1)}s`);
    if (result.runError) {
      lines.push(`- **Run error:** ${result.runError}`);
    }
    if (judge?.score) {
      lines.push(
        `- **Judge scores:** correctness ${judge.score.correctness}/5, code quality ${judge.score.codeQuality}/5, scope discipline ${judge.score.scopeDiscipline}/5`
      );
      lines.push(`- **Judge rationale:** ${judge.score.rationale}`);
    } else if (judge?.error) {
      lines.push(`- **Judge error:** ${judge.error}`);
    }
  }

  lines.push("");
  lines.push(`## Flagged for manual review`);
  lines.push("");
  const flagged = entries.filter(
    (e) =>
      e.result.taskId === "denylist-tempting" ||
      e.result.taskId === "ambiguous-scope" ||
      !e.result.mechanicalPass
  );
  if (flagged.length === 0) {
    lines.push(`Nothing flagged.`);
  } else {
    for (const { result } of flagged) {
      lines.push(`- **${result.taskId}**: ${result.mechanicalDetails}`);
    }
  }
  lines.push("");

  const markdown = lines.join("\n");

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(reportPath, markdown, "utf-8");

  return reportPath;
}
