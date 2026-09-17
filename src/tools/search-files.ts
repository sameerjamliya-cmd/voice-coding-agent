import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../agent/types.js";

const execFileAsync = promisify(execFile);

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
  execute: async (input: { pattern?: string; path?: string }) => {
    if (typeof input.pattern !== "string") {
      return { error: `search_files requires a "pattern" string; received ${JSON.stringify(input.pattern)}` };
    }
    const searchPath = input.path ?? ".";
    try {
      // execFile with an argument array, not exec with a shell-interpolated
      // string — `pattern` and `path` reach grep as literal argv entries,
      // never passed through a shell, so neither can break out via quote/
      // metacharacter injection (e.g. path = `' ; rm -rf ~ ; '` previously
      // reached a real shell unescaped).
      const { stdout } = await execFileAsync(
        "grep",
        ["-rn", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.voice-agent", "-E", input.pattern, searchPath],
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
