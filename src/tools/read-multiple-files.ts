import { readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const readMultipleFilesTool: Tool = {
  name: "read_multiple_files",
  description:
    "Read the full contents of several files in one call, to avoid one round-trip per file when a task needs context from many files.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Paths of the files to read",
      },
    },
    required: ["paths"],
  },
  execute: async (input: { paths: string[] }) => {
    const sections = await Promise.all(
      input.paths.map(async (path) => {
        try {
          const content = await readFile(path, "utf-8");
          return `--- ${path} ---\n${content}`;
        } catch (err: any) {
          return `--- ${path} ---\nError: ${err.message}`;
        }
      })
    );
    return { output: sections.join("\n\n") };
  },
};
