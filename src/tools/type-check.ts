import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../agent/types.js";
import { getPackageScripts, runNpmScript } from "./shared/run-npm-script.js";

const execAsync = promisify(exec);

function summarize(output: string, exitCode: number): string {
  const errorLines = [...output.matchAll(/^.+error TS\d+:.+$/gm)].map((m) => m[0]);
  const lines = [`exit code: ${exitCode}`, `status: ${exitCode === 0 ? "no type errors" : "type errors found"}`];
  if (errorLines.length) {
    lines.push(`errors (${errorLines.length}):\n${errorLines.slice(0, 50).join("\n")}`);
  } else {
    lines.push(output.slice(-2000));
  }
  return lines.join("\n");
}

export const typeCheckTool: Tool = {
  name: "type_check",
  description:
    "Run the project's type checker (package.json's \"typecheck\" script if present, otherwise \"tsc --noEmit\") and return a structured summary of type errors.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => {
    const cwd = input.cwd ?? ".";
    try {
      const scripts = await getPackageScripts(cwd);
      if (scripts.typecheck) {
        const { exitCode, output } = await runNpmScript("typecheck", cwd);
        const summary = summarize(output, exitCode);
        return exitCode === 0 ? { output: summary } : { error: summary };
      }

      try {
        const { stdout, stderr } = await execAsync("npx tsc --noEmit", {
          cwd,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { output: summarize([stdout, stderr].filter(Boolean).join("\n"), 0) };
      } catch (err: any) {
        const output = [err.stdout, err.stderr].filter(Boolean).join("\n") || err.message;
        return { error: summarize(output, typeof err.code === "number" ? err.code : 1) };
      }
    } catch (err: any) {
      return { error: err.message };
    }
  },
};
