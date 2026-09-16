import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApprovalPreview } from "../src/harness/diff-preview.js";

describe("buildApprovalPreview", () => {
  // move_file and run_command don't touch the filesystem, so no setup needed.
  it("move_file: renders a simple rename arrow", async () => {
    const preview = await buildApprovalPreview("move_file", { from: "a.ts", to: "b.ts" }, ".");
    expect(preview).toBe("a.ts -> b.ts");
  });

  it("run_command: renders the command string", async () => {
    const preview = await buildApprovalPreview("run_command", { command: "npm test" }, ".");
    expect(preview).toBe("command: npm test");
  });

  it("unknown tool name: returns an empty string (no preview)", async () => {
    const preview = await buildApprovalPreview("ask_user", { question: "x" }, ".");
    expect(preview).toBe("");
  });

  // write_file, edit_file, and delete_file all read real files to build
  // their preview, so they need an actual directory on disk to point at.
  describe("with a real temp project directory", () => {
    let cwd: string;

    beforeAll(async () => {
      // mkdtemp gives us a unique directory per test run, so parallel test
      // runs (or leftover state from a previous crashed run) never collide.
      cwd = await mkdtemp(join(tmpdir(), "diff-preview-test-"));
      await writeFile(join(cwd, "existing.txt"), "line one\nline two\nline three\n", "utf-8");
    });

    afterAll(async () => {
      // Clean up so we don't leave temp directories behind after every run.
      await rm(cwd, { recursive: true, force: true });
    });

    it("write_file on a path that doesn't exist yet: labels it a new file", async () => {
      const preview = await buildApprovalPreview(
        "write_file",
        { path: "brand-new.txt", content: "hello" },
        cwd
      );
      expect(preview).toBe("--- brand-new.txt (new file) ---\nhello");
    });

    it("write_file overwriting an existing file: renders a real before/after diff", async () => {
      const preview = await buildApprovalPreview(
        "write_file",
        { path: "existing.txt", content: "line one\nCHANGED\nline three\n" },
        cwd
      );
      // createTwoFilesPatch's exact formatting is a library detail we don't
      // want to hardcode a byte-for-byte match against (it would make the
      // test brittle to a diff-library upgrade) — just assert the parts
      // that prove it's a real diff, not a "new file" listing.
      expect(preview).toContain("-line two");
      expect(preview).toContain("+CHANGED");
    });

    it("delete_file on an existing file: shows path, size, and content", async () => {
      const preview = await buildApprovalPreview("delete_file", { path: "existing.txt" }, cwd);
      expect(preview).toContain("will delete existing.txt");
      expect(preview).toContain("line one\nline two\nline three");
    });

    it("delete_file on a missing file: reports it couldn't be read, doesn't throw", async () => {
      const preview = await buildApprovalPreview("delete_file", { path: "nope.txt" }, cwd);
      expect(preview).toContain("could not read file");
    });

    it("edit_file: shows a context-snippet diff around the matched text", async () => {
      const preview = await buildApprovalPreview(
        "edit_file",
        { path: "existing.txt", old_string: "line two", new_string: "line TWO" },
        cwd
      );
      expect(preview).toContain(" line one"); // unchanged context, space-prefixed
      expect(preview).toContain("-line two"); // removed
      expect(preview).toContain("+line TWO"); // added
      expect(preview).toContain(" line three"); // unchanged context after
    });

    it("edit_file: when old_string isn't in the file, says so instead of crashing", async () => {
      const preview = await buildApprovalPreview(
        "edit_file",
        { path: "existing.txt", old_string: "does not exist", new_string: "x" },
        cwd
      );
      expect(preview).toContain("old_string not found");
    });

    it("delete_file: never renders diff-style +/- markers, only raw content", async () => {
      const preview = await buildApprovalPreview("delete_file", { path: "existing.txt" }, cwd);
      const [, ...bodyLines] = preview.split("\n"); // drop the "--- will delete ... ---" header line
      expect(bodyLines.join("\n")).not.toMatch(/^[+-]/m);
    });

    it("move_file: renders a rename, not any kind of content comparison", async () => {
      const preview = await buildApprovalPreview("move_file", { from: "existing.txt", to: "renamed.txt" }, cwd);
      expect(preview).toBe("existing.txt -> renamed.txt");
      expect(preview).not.toContain("line one");
    });

    describe("edit_file context window edge cases", () => {
      let contextCwd: string;

      beforeAll(async () => {
        contextCwd = await mkdtemp(join(tmpdir(), "diff-preview-context-test-"));
        // 10 lines, so a match at line 1 has no "before" context available,
        // and a match at the last line has no "after" context available —
        // CONTEXT_LINES is 3, so either edge case would slice a negative
        // or out-of-bounds range if not clamped correctly.
        const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
        await writeFile(join(contextCwd, "long.txt"), lines.join("\n") + "\n", "utf-8");
      });

      afterAll(async () => {
        await rm(contextCwd, { recursive: true, force: true });
      });

      it("a match at the very start of the file has no before-context, but still renders", async () => {
        const preview = await buildApprovalPreview(
          "edit_file",
          { path: "long.txt", old_string: "line 1", new_string: "LINE ONE" },
          contextCwd
        );
        expect(preview).toContain("-line 1");
        expect(preview).toContain("+LINE ONE");
        expect(preview).toContain(" line 2"); // after-context still present
        // No stray context line from "before the start of the file".
        expect(preview).not.toContain("line 0");
      });

      it("a match at the very end of the file has no after-context, but still renders", async () => {
        const preview = await buildApprovalPreview(
          "edit_file",
          { path: "long.txt", old_string: "line 10", new_string: "LINE TEN" },
          contextCwd
        );
        expect(preview).toContain("-line 10");
        expect(preview).toContain("+LINE TEN");
        expect(preview).toContain(" line 9"); // before-context still present
        expect(preview).not.toContain("line 11");
      });

      it("a multi-line old_string/new_string renders every line with its own +/- prefix", async () => {
        const preview = await buildApprovalPreview(
          "edit_file",
          {
            path: "long.txt",
            old_string: "line 4\nline 5\nline 6",
            new_string: "FOUR\nFIVE\nSIX",
          },
          contextCwd
        );
        expect(preview).toContain("-line 4");
        expect(preview).toContain("-line 5");
        expect(preview).toContain("-line 6");
        expect(preview).toContain("+FOUR");
        expect(preview).toContain("+FIVE");
        expect(preview).toContain("+SIX");
        // Context before/after the whole multi-line block, not per-line.
        expect(preview).toContain(" line 3");
        expect(preview).toContain(" line 7");
      });
    });
  });
});

// Whether a diff preview is shown at all is a harness.ts decision, not
// diff-preview.ts's own — buildApprovalPreview has no concept of approval
// memory. This has to be tested at the Harness level: an auto-approved
// (memory-matched) call must produce NO console output from the preview
// step, not just skip the confirmation prompt.
describe("auto-approved calls skip the preview entirely", () => {
  it("a second call matching a remembered pattern produces no preview output", async () => {
    vi.resetModules();
    vi.doMock("../src/shared/terminal-prompt.js", () => ({
      confirm: vi.fn(async () => true),
      choice: vi.fn(async (_q: string, options: string[]) => options[0]),
      prompt: vi.fn(async () => ""),
      closePrompt: vi.fn(),
      isVoiceModeActive: vi.fn(() => false),
    }));

    const { Harness } = await import("../src/harness/harness.js");
    const { ToolRegistry } = await import("../src/tools/registry.js");
    const { writeFileTool } = await import("../src/tools/write-file.js");
    const { createTempGitRepo } = await import("./helpers/temp-git-repo.js");
    const { join: joinPath } = await import("node:path");

    const repo = await createTempGitRepo();
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    // write_file takes `path` as given — it isn't scoped through
    // harness's cwd (only used for git/config) — so this must be an
    // absolute path into the temp repo, not a bare relative one.
    const targetPath = joinPath(repo.cwd, "a.txt");

    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });
    const logSpy = vi.spyOn(console, "log");

    try {
      // First call: no remembered pattern yet, so this DOES show a preview.
      await harness.execute("write_file", { path: targetPath, content: "v1" });
      const firstCallLoggedPreview = logSpy.mock.calls.some((args) =>
        String(args[0]).includes("(new file)")
      );
      expect(firstCallLoggedPreview).toBe(true);

      logSpy.mockClear();

      // Second call: same file, same tool — matches the remembered pattern
      // from the first call, so it auto-approves and must show nothing.
      await harness.execute("write_file", { path: targetPath, content: "v2" });
      const secondCallLoggedAnything = logSpy.mock.calls.length > 0;
      expect(secondCallLoggedAnything).toBe(false);

      await harness.endSession("completed");
    } finally {
      logSpy.mockRestore();
      await repo.cleanup();
      vi.doUnmock("../src/shared/terminal-prompt.js");
    }
  });
});
