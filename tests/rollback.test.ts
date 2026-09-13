import { describe, it, expect, vi } from "vitest";
import { writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { git, createTempGitRepo } from "./helpers/temp-git-repo.js";
import { GitSnapshotManager } from "../src/harness/snapshot.js";
import { openHarnessDb } from "../src/harness/db/connection.js";
import { HistoryLog } from "../src/harness/db/history.js";

// This is core to harness's actual safety guarantee, so these tests
// assert real byte-for-byte file content after a real `git reset --hard`
// in a real temp repo — not just "the call didn't throw".

describe("GitSnapshotManager rollback", () => {
  it("restores a file's pre-mutation content byte-for-byte after rollback()", async () => {
    const repo = await createTempGitRepo();
    try {
      const snapshots = new GitSnapshotManager(repo.cwd);

      // Establishes taskSnapshotSha at the current (clean, file-less) state.
      const readiness = await snapshots.ensureReadyForMutation(async () => true);
      expect(readiness.ok).toBe(true);

      const filePath = join(repo.cwd, "a.txt");
      await writeFile(filePath, "mutated content", "utf-8");

      await snapshots.rollback();

      // The file didn't exist at the snapshot point, so after rollback it
      // must be gone entirely — reset --hard alone wouldn't remove an
      // untracked new file, which is exactly the bug this rollback()
      // implementation exists to close (see its own comment about `git clean`).
      await expect(access(filePath)).rejects.toThrow();
    } finally {
      await repo.cleanup();
    }
  });

  it("restores modified (not just newly-created) file content byte-for-byte", async () => {
    const repo = await createTempGitRepo();
    try {
      const original = "line one\nline two\nline three\n";
      const filePath = join(repo.cwd, "existing.txt");
      await writeFile(filePath, original, "utf-8");
      await git(["add", "-A"], repo.cwd);
      await git(["commit", "-q", "-m", "add existing.txt"], repo.cwd);

      const snapshots = new GitSnapshotManager(repo.cwd);
      const readiness = await snapshots.ensureReadyForMutation(async () => true);
      expect(readiness.ok).toBe(true);

      await writeFile(filePath, "completely different content\n", "utf-8");
      await snapshots.rollback();

      const restored = await readFile(filePath, "utf-8");
      expect(restored).toBe(original);
    } finally {
      await repo.cleanup();
    }
  });

  it("rolling back to a middle snapshot (of three sequential ones) restores that exact intermediate state, not the first or last", async () => {
    const repo = await createTempGitRepo();
    try {
      const filePath = join(repo.cwd, "a.txt");
      const snapshots = new GitSnapshotManager(repo.cwd);

      await snapshots.ensureReadyForMutation(async () => true);

      // Mirrors real per-call-tool ordering: snapshotBeforeCall() commits
      // whatever's pending from the previous mutation, THEN the new
      // mutation happens uncommitted until the next snapshot (or session
      // finalization) commits it.
      await snapshots.snapshotBeforeCall("write v1"); // nothing pending yet
      await writeFile(filePath, "version 1", "utf-8");

      const { sha: shaBeforeV2 } = await snapshots.snapshotBeforeCall("write v2"); // commits v1
      await writeFile(filePath, "version 2", "utf-8");

      await snapshots.snapshotBeforeCall("write v3"); // commits v2
      await writeFile(filePath, "version 3", "utf-8");

      // Roll back to the point captured right before v2 was written —
      // the middle snapshot, not the very first or very last.
      await git(["reset", "--hard", shaBeforeV2], repo.cwd);
      await git(["clean", "-fd", "-e", ".voice-agent/"], repo.cwd);

      const restored = await readFile(filePath, "utf-8");
      expect(restored).toBe("version 1");
    } finally {
      await repo.cleanup();
    }
  });
});

describe("agent undo safety check", () => {
  it("refuses to proceed when the working directory has uncommitted changes outside the agent's snapshot chain", async () => {
    const repo = await createTempGitRepo();
    try {
      const filePath = join(repo.cwd, "tracked.txt");
      await writeFile(filePath, "original", "utf-8");
      await git(["add", "-A"], repo.cwd);
      await git(["commit", "-q", "-m", "add tracked file"], repo.cwd);

      // Simulate a manual edit made by the user directly, outside the
      // agent — never committed, so it looks exactly like agent-left
      // state would if finalizeSession hadn't run. undo must not be able
      // to tell the difference, and must refuse rather than guess.
      await writeFile(filePath, "manually edited, not by the agent", "utf-8");

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { runUndo } = await import("../src/harness/undo.js");
      await runUndo({ list: false, cwd: repo.cwd });

      expect(errorSpy).toHaveBeenCalled();
      const message = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(message).toMatch(/uncommitted changes/i);

      // Nothing was discarded — the manual edit must still be there.
      const stillThere = await readFile(filePath, "utf-8");
      expect(stillThere).toBe("manually edited, not by the agent");

      errorSpy.mockRestore();
    } finally {
      await repo.cleanup();
    }
  });
});

describe("rollback observability: automatic vs. manual are distinguishable", () => {
  it("recordRollback logs distinct triggered_by values for validation_failure vs. manual_undo", async () => {
    const repo = await createTempGitRepo();
    try {
      const db = openHarnessDb(repo.cwd);
      try {
        const history = new HistoryLog(db, "test session");
        const snapshotId = history.recordSnapshot("deadbeef", "task_start", "test snapshot");
        const validationId = history.recordValidation("mark_task_complete", false, "test failure", 10, "task", "summary");

        history.recordRollback(snapshotId, validationId, "validation_failure");
        history.recordRollback(snapshotId, null, "manual_undo");

        const rows = db.prepare(`SELECT triggered_by, triggered_by_validation_id FROM rollbacks ORDER BY id`).all() as {
          triggered_by: string;
          triggered_by_validation_id: number | null;
        }[];

        expect(rows).toHaveLength(2);
        expect(rows[0].triggered_by).toBe("validation_failure");
        expect(rows[0].triggered_by_validation_id).toBe(validationId);
        expect(rows[1].triggered_by).toBe("manual_undo");
        expect(rows[1].triggered_by_validation_id).toBeNull();

        // The two categories must actually differ from each other — the
        // whole point of the distinction.
        expect(rows[0].triggered_by).not.toBe(rows[1].triggered_by);
      } finally {
        db.close();
      }
    } finally {
      await repo.cleanup();
    }
  });
});
