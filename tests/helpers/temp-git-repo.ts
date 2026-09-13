import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

export interface TempGitRepo {
  cwd: string;
  cleanup(): Promise<void>;
}

// A real, freshly-initialized git repo in the OS temp directory — never
// this project's own working tree. Committer identity is set locally
// (not relying on any global git config existing in the environment
// running these tests) so commits succeed everywhere, including CI.
export async function createTempGitRepo(): Promise<TempGitRepo> {
  const cwd = await mkdtemp(join(tmpdir(), "agent-test-repo-"));
  await git(["init", "-q"], cwd);
  await git(["config", "user.email", "test@example.com"], cwd);
  await git(["config", "user.name", "Test"], cwd);
  await git(["commit", "-q", "--allow-empty", "-m", "initial"], cwd);

  return {
    cwd,
    cleanup: async () => {
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
