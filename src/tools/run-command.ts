import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../agent/types.js";

const execAsync = promisify(exec);

// TODO(Phase 2 / harness): no sandboxing, approval gates, or timeouts beyond
// the basic one below. This tool executes arbitrary shell commands directly.
export const runCommandTool: Tool = {
  name: "run_command",
  description: "Execute a shell command and return its stdout/stderr output.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      cwd: { type: "string", description: "Working directory to run the command in" },
    },
    required: ["command"],
  },
  execute: async (input: { command: string; cwd?: string }) => {
    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: input.cwd,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { output: output || "(no output)" };
    } catch (err: any) {
      return { error: err?.stderr || err?.message || String(err) };
    }
  },
};
