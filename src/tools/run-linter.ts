import type { Tool } from "../agent/types.js";
import { runNpmScript } from "./shared/run-npm-script.js";

function summarize(output: string, exitCode: number): string {
  const problemCounts = output.match(/(\d+)\s+problems?\s+\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i);
  const lines = [`exit code: ${exitCode}`, `status: ${exitCode === 0 ? "clean" : "issues found"}`];
  if (problemCounts) {
    lines.push(`summary: ${problemCounts[0]}`);
  }
  lines.push(output.slice(-3000));
  return lines.join("\n");
}

export const runLinterTool: Tool = {
  name: "run_linter",
  description:
    "Run the project's lint command (from package.json's \"lint\" script) and return a structured summary of issues found.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => {
    try {
      const { exitCode, output } = await runNpmScript("lint", input.cwd ?? ".");
      const summary = summarize(output, exitCode);
      return exitCode === 0 ? { output: summary } : { error: summary };
    } catch (err: any) {
      return { error: err.message };
    }
  },
};
