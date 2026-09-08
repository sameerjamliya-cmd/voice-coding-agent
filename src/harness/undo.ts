import { exec } from "node:child_process";
import { promisify } from "node:util";
import { openHarnessDb } from "./db/connection.js";
import { HistoryLog } from "./db/history.js";
import { confirm, prompt } from "../shared/terminal-prompt.js";

const execAsync = promisify(exec);

async function git(args: string, cwd: string) {
  return execAsync(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

interface SnapshotRow {
  id: number;
  timestamp: string;
  git_sha: string;
  trigger: string;
  description: string | null;
}

export interface RunUndoOptions {
  list: boolean;
  cwd: string;
}

export async function runUndo(options: RunUndoOptions): Promise<void> {
  const db = openHarnessDb(options.cwd);
  const history = new HistoryLog(db, `manual undo${options.list ? " (--list)" : ""}`);

  try {
    // Mirrors the clean-working-directory principle required at task
    // start: harness always leaves a clean tree at session end (see
    // GitSnapshotManager.finalizeSession), so ANY uncommitted change found
    // here must be the user's own, made outside the agent — never
    // silently discard it.
    const { stdout: status } = await git("status --porcelain", options.cwd);
    if (status.trim().length > 0) {
      console.error(
        "Your working directory has uncommitted changes. The agent always leaves a clean working tree " +
          "when it finishes, so these must be your own edits — undo refuses to proceed rather than risk " +
          "discarding them. Commit or stash your changes first."
      );
      history.endSession("abandoned");
      process.exitCode = 1;
      return;
    }

    const target = options.list ? await pickFromList(db) : mostRecent(db);

    if (!target) {
      console.log("No snapshots recorded yet — nothing to undo.");
      history.endSession("abandoned");
      return;
    }

    const label = target.description ?? target.trigger;
    const proceed = await confirm(`\nUndo: ${label} (${relativeTime(target.timestamp)})?`);
    if (!proceed) {
      console.log("Cancelled.");
      history.endSession("abandoned");
      return;
    }

    await git(`reset --hard ${target.git_sha}`, options.cwd);
    await git("clean -fd -e .voice-agent/", options.cwd);
    console.log(`Reverted to ${target.git_sha.slice(0, 8)}.`);

    history.recordRollback(target.id, null, "manual_undo");
    history.endSession("completed");
  } finally {
    db.close();
  }
}

function mostRecent(db: ReturnType<typeof openHarnessDb>): SnapshotRow | undefined {
  return db
    .prepare(`SELECT id, timestamp, git_sha, trigger, description FROM snapshots ORDER BY id DESC LIMIT 1`)
    .get() as SnapshotRow | undefined;
}

async function pickFromList(db: ReturnType<typeof openHarnessDb>): Promise<SnapshotRow | undefined> {
  const rows = db
    .prepare(`SELECT id, timestamp, git_sha, trigger, description FROM snapshots ORDER BY id DESC LIMIT 10`)
    .all() as unknown as SnapshotRow[];

  if (rows.length === 0) return undefined;

  console.log("\nRecent snapshots:\n");
  rows.forEach((row, i) => {
    console.log(`  ${i + 1}) ${row.description ?? row.trigger} (${relativeTime(row.timestamp)})`);
  });

  while (true) {
    const raw = (await prompt(`\nSelect one to revert to (1-${rows.length}), or 'c' to cancel: `)).trim().toLowerCase();
    if (raw === "c" || raw === "cancel") return undefined;
    const num = Number(raw);
    if (Number.isInteger(num) && num >= 1 && num <= rows.length) {
      return rows[num - 1];
    }
    console.log(`Please enter a number from 1-${rows.length}, or 'c' to cancel.`);
  }
}

function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
