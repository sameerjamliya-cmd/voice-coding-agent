import { readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

export const readPackageManifestTool: Tool = {
  name: "read_package_manifest",
  description:
    "Parse package.json and return its name, scripts, and dependencies so Claude knows what's already available before suggesting anything new.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory containing package.json (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => {
    const path = `${input.cwd ?? "."}/package.json`;
    try {
      const raw = await readFile(path, "utf-8");
      const pkg = JSON.parse(raw);
      const summary = {
        name: pkg.name,
        version: pkg.version,
        scripts: pkg.scripts ?? {},
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      };
      return { output: JSON.stringify(summary, null, 2) };
    } catch (err: any) {
      return { error: `Failed to read "${path}": ${err.message}` };
    }
  },
};
