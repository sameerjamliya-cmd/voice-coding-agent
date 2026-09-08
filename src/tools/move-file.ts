import { rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "../agent/types.js";

export const moveFileTool: Tool = {
  name: "move_file",
  description: "Move or rename a file from one path to another.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Current path of the file" },
      to: { type: "string", description: "New path for the file" },
    },
    required: ["from", "to"],
  },
  execute: async (input: { from: string; to: string }) => {
    try {
      await mkdir(dirname(input.to), { recursive: true });
      await rename(input.from, input.to);
      return { output: `Moved "${input.from}" to "${input.to}"` };
    } catch (err: any) {
      return { error: `Failed to move "${input.from}" to "${input.to}": ${err.message}` };
    }
  },
};
