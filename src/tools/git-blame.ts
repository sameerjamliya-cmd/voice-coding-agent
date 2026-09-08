import type { Tool } from "../agent/types.js";
import { runGit } from "./shared/run-git.js";

export const gitBlameTool: Tool = {
  name: "git_blame",
  description: "Show what revision and author last modified each line of a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file" },
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string; cwd?: string }) =>
    runGit(`blame -- "${input.path}"`, input.cwd ?? "."),
};
