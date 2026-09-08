import { unlink } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file at the given path.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to delete" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string }) => {
    try {
      await unlink(input.path);
      return { output: `Deleted "${input.path}"` };
    } catch (err: any) {
      return { error: `Failed to delete "${input.path}": ${err.message}` };
    }
  },
};
