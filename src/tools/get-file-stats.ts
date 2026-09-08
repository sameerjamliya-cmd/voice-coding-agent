import { stat, readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const getFileStatsTool: Tool = {
  name: "get_file_stats",
  description:
    "Get line count and byte size for a file, as a cheap sanity check before deciding whether to read it in full.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string }) => {
    try {
      const [stats, content] = await Promise.all([
        stat(input.path),
        readFile(input.path, "utf-8"),
      ]);
      const lineCount = content.length === 0 ? 0 : content.split("\n").length;
      return {
        output: `size: ${stats.size} bytes\nlines: ${lineCount}`,
      };
    } catch (err: any) {
      return { error: `Failed to stat "${input.path}": ${err.message}` };
    }
  },
};
