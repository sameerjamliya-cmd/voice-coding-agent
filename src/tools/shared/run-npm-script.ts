import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ScriptRunResult {
  exitCode: number;
  output: string;
}

export async function getPackageScripts(cwd = "."): Promise<Record<string, string>> {
  const raw = await readFile(`${cwd}/package.json`, "utf-8");
  const pkg = JSON.parse(raw);
  return pkg.scripts ?? {};
}

export async function runNpmScript(
  scriptName: string,
  cwd = "."
): Promise<ScriptRunResult> {
  const scripts = await getPackageScripts(cwd);
  if (!scripts[scriptName]) {
    throw new Error(
      `No "${scriptName}" script found in package.json (available: ${Object.keys(scripts).join(", ") || "none"})`
    );
  }

  try {
    const { stdout, stderr } = await execAsync(`npm run ${scriptName} --silent`, {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, output: [stdout, stderr].filter(Boolean).join("\n") };
  } catch (err: any) {
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      output: [err.stdout, err.stderr].filter(Boolean).join("\n") || err.message,
    };
  }
}
