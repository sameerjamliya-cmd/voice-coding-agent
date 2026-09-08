import type { Tool } from "../agent/types.js";
import { runNpmScript } from "./shared/run-npm-script.js";

// Best-effort structured summary across common test runners (jest, vitest,
// mocha, node's own test runner). Falls back to raw output if no known
// summary pattern matches.
function summarize(output: string, exitCode: number): string {
  const summaryPatterns = [
    /Tests:\s+.*$/m, // jest/vitest
    /\d+ passing.*$/m, // mocha
    /\d+ failing.*$/m, // mocha
    /# (pass|fail) \d+/gim, // node:test / tap
  ];

  const summaryLines = summaryPatterns
    .flatMap((re) => output.match(re) ?? [])
    .join("\n");

  const failingTestPattern = /^\s*(✕|✗|×|✖)\s+(.+)$/gm;
  const failingTests = [...output.matchAll(failingTestPattern)].map((m) => m[2].trim());

  const lines = [`exit code: ${exitCode}`, `status: ${exitCode === 0 ? "passed" : "failed"}`];
  if (summaryLines) lines.push(summaryLines);
  if (failingTests.length) {
    lines.push(`failing tests:\n${[...new Set(failingTests)].map((t) => `  - ${t}`).join("\n")}`);
  }
  if (!summaryLines && !failingTests.length) {
    lines.push("(no recognized summary format; raw output below)", output.slice(-2000));
  }
  return lines.join("\n");
}

export const runTestsTool: Tool = {
  name: "run_tests",
  description:
    "Run the project's test command (from package.json's \"test\" script) and return a structured pass/fail summary with failing test names where recognizable.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => {
    try {
      const { exitCode, output } = await runNpmScript("test", input.cwd ?? ".");
      const summary = summarize(output, exitCode);
      return exitCode === 0 ? { output: summary } : { error: summary };
    } catch (err: any) {
      return { error: err.message };
    }
  },
};
