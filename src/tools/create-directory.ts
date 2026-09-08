import { mkdir } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const createDirectoryTool: Tool = {
  name: "create_directory",
  description: "Create a directory, including any missing parent directories.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of the directory to create" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string }) => {
    try {
      await mkdir(input.path, { recursive: true });
      return { output: `Created directory "${input.path}"` };
    } catch (err: any) {
      return { error: `Failed to create directory "${input.path}": ${err.message}` };
    }
  },
};
