import { readFile } from "node:fs/promises";
import type { Tool } from "../agent/types.js";

async function installedVersion(cwd: string, name: string): Promise<string | null> {
  try {
    const raw = await readFile(`${cwd}/node_modules/${name}/package.json`, "utf-8");
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
}

export const listInstalledPackagesTool: Tool = {
  name: "list_installed_packages",
  description:
    "List dependencies and devDependencies declared in package.json, along with the version actually installed in node_modules where available.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory containing package.json (default: current directory)" },
    },
    required: [],
  },
  execute: async (input: { cwd?: string }) => {
    const cwd = input.cwd ?? ".";
    try {
      const raw = await readFile(`${cwd}/package.json`, "utf-8");
      const pkg = JSON.parse(raw);
      const all: Record<string, string> = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      const names = Object.keys(all);
      if (!names.length) {
        return { output: "(no dependencies declared)" };
      }

      const lines = await Promise.all(
        names.map(async (name) => {
          const installed = await installedVersion(cwd, name);
          return `${name}: declared ${all[name]}, installed ${installed ?? "(not found in node_modules)"}`;
        })
      );

      return { output: lines.join("\n") };
    } catch (err: any) {
      return { error: `Failed to read package.json in "${cwd}": ${err.message}` };
    }
  },
};
