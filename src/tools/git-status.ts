import type { Tool } from "../agent/types.js";
import { runGit } from "./shared/run-git.js";

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Show the working tree status (git status).",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => runGit("status", input.cwd ?? "."),
};
