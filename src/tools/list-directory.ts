import { readdir } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

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
  execute: async (input: { path: string }) => {
    try {
      const entries = await readdir(input.path, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`);
      return { output: lines.length ? lines.join("\n") : "(empty directory)" };
    } catch (err: any) {
      return { error: `Failed to list "${input.path}": ${err.message}` };
    }
  },
};
