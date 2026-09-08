import type { Tool } from "../agent/types.js";
import { runGit } from "./shared/run-git.js";

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show changes between the working tree and the index, or a specific file's diff.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Limit the diff to a specific file or directory" },
      staged: { type: "boolean", description: "Show staged changes instead of unstaged" },
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { path?: string; staged?: boolean; cwd?: string }) => {
    const flags = input.staged ? "--staged" : "";
    const pathArg = input.path ? ` -- "${input.path}"` : "";
    return runGit(`diff ${flags}${pathArg}`.trim(), input.cwd ?? ".");
  },
};
