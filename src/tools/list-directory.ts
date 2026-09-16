import { readdir } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

// harness.ts's own operational database (session history, approval memory)
// — never part of "the project" from the agent's point of view. Left
// visible, an agent exploring an unfamiliar directory (no established
// convention to recognize and skip it, unlike .git) can wander into it and
// try to read harness.db as if it were project content — confirmed via a
// real benchmark run where the agent read the raw SQLite binary, got
// garbled output, and concluded there was no real codebase to work with,
// never having looked at the actual source files sitting right next to it.
const HIDDEN_ENTRIES = new Set([".voice-agent"]);

export const listDirectoryTool: Tool = {
  name: "list_directory",
  description: "List the files and subdirectories in a given directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the directory to list" },
    },
    required: ["path"],
  },
  execute: async (input: { path?: string }) => {
    const path = input.path ?? ".";
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const lines = entries
        .filter((e) => !HIDDEN_ENTRIES.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`);
      return { output: lines.length ? lines.join("\n") : "(empty directory)" };
    } catch (err: any) {
      return { error: `Failed to list "${path}": ${err.message}` };
    }
  },
};
