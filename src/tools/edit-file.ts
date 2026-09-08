import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Edit a file by replacing an exact string match with new content. The old_string must appear exactly once in the file unless replace_all is set.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit" },
      old_string: { type: "string", description: "Exact text to find and replace" },
      new_string: { type: "string", description: "Text to replace it with" },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences instead of requiring exactly one match",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  execute: async (input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }) => {
    try {
      const content = await readFile(input.path, "utf-8");
      const occurrences = content.split(input.old_string).length - 1;

      if (occurrences === 0) {
        return { error: `old_string not found in "${input.path}"` };
      }
      if (occurrences > 1 && !input.replace_all) {
        return {
          error: `old_string appears ${occurrences} times in "${input.path}"; use replace_all or provide a more specific match`,
        };
      }

      const updated = input.replace_all
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string);

      await writeFile(input.path, updated, "utf-8");
      return { output: `Edited "${input.path}" (${occurrences} replacement${occurrences > 1 ? "s" : ""})` };
    } catch (err: any) {
      return { error: `Failed to edit "${input.path}": ${err.message}` };
    }
  },
};
