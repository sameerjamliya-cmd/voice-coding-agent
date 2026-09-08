import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../agent/types.js";

const execAsync = promisify(exec);

export const searchFilesTool: Tool = {
  name: "search_files",
  description: "Search for a regex pattern across files in a directory (grep-like).",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory to search in (default: current directory)" },
    },
    required: ["pattern"],
  },
  execute: async (input: { pattern: string; path?: string }) => {
    const searchPath = input.path ?? ".";
    try {
      const escaped = input.pattern.replace(/'/g, `'\\''`);
      const { stdout } = await execAsync(
        `grep -rn --exclude-dir=node_modules --exclude-dir=.git -E '${escaped}' '${searchPath}'`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      return { output: stdout.trim() || "(no matches)" };
    } catch (err: any) {
      if (err.code === 1) {
        return { output: "(no matches)" };
      }
      return { error: err?.stderr || err?.message || String(err) };
    }
  },
};
