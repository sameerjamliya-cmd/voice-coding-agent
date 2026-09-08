import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "../agent/types.js";

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write content to a file at the given path, creating it (and parent directories) if needed. Overwrites existing files.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write to the file" },
    },
    required: ["path", "content"],
  },
  execute: async (input: { path: string; content: string }) => {
    try {
      await mkdir(dirname(input.path), { recursive: true });
      await writeFile(input.path, input.content, "utf-8");
      return { output: `Wrote ${input.content.length} bytes to "${input.path}"` };
    } catch (err: any) {
      return { error: `Failed to write "${input.path}": ${err.message}` };
    }
  },
};
