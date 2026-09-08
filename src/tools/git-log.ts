import type { Tool } from "../agent/types.js";
import { runGit } from "./shared/run-git.js";

export const gitLogTool: Tool = {
  name: "git_log",
  description: "Show commit history, most recent first.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max number of commits to show (default: 20)" },
      path: { type: "string", description: "Limit history to a specific file or directory" },
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { limit?: number; path?: string; cwd?: string }) => {
    const limit = input.limit ?? 20;
    const pathArg = input.path ? ` -- "${input.path}"` : "";
    return runGit(`log -n ${limit} --oneline --decorate${pathArg}`, input.cwd ?? ".");
  },
};
