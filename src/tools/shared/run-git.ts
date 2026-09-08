import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runGit(args: string, cwd = "."): Promise<{ output?: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return { output: output || "(no output)" };
  } catch (err: any) {
    return { error: err?.stderr || err?.message || String(err) };
  }
}
