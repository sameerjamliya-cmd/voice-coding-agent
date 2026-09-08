import { readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

// Heuristic, regex-based outline extraction — not a real parser. Good enough
// to let Claude decide whether to read a file in full without spending
// context on it up front. Covers common JS/TS/Python declaration shapes.
const PATTERNS: RegExp[] = [
  /^\s*export\s+default\s+(function|class)\s+([A-Za-z0-9_$]+)/,
  /^\s*export\s+(async\s+function|function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/,
  /^\s*(async\s+function|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/,
  /^\s*(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(?.*=>/,
  /^\s*def\s+([A-Za-z0-9_]+)\s*\(/,
  /^\s*class\s+([A-Za-z0-9_]+)/,
];

export const getFileOutlineTool: Tool = {
  name: "get_file_outline",
  description:
    "List top-level functions/classes/exports declared in a file without returning its full content, to keep context usage down on large files. Heuristic (regex-based), not a full parser.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file" },
    },
    required: ["path"],
  },
  execute: async (input: { path: string }) => {
    try {
      const content = await readFile(input.path, "utf-8");
      const lines = content.split("\n");
      const matches: string[] = [];

      lines.forEach((line, i) => {
        if (PATTERNS.some((re) => re.test(line))) {
          matches.push(`${i + 1}: ${line.trim()}`);
        }
      });

      return {
        output: matches.length ? matches.join("\n") : "(no top-level declarations found)",
      };
    } catch (err: any) {
      return { error: `Failed to read "${input.path}": ${err.message}` };
    }
  },
};
