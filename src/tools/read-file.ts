import { readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read the full contents of a file at the given path.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read" },
    },
    required: ["path"],
  },
  execute: async (input: { path?: string }) => {
    if (typeof input.path !== "string") {
      return { error: `read_file requires a "path" string; received ${JSON.stringify(input.path)}` };
    }
    try {
      const content = await readFile(input.path, "utf-8");
      return { output: content };
    } catch (err: any) {
      return { error: `Failed to read "${input.path}": ${err.message}` };
    }
  },
};
