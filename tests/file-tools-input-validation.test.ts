import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listDirectoryTool } from "../src/tools/list-directory.js";
import { readFileTool } from "../src/tools/read-file.js";
import { readMultipleFilesTool } from "../src/tools/read-multiple-files.js";
import { searchFilesTool } from "../src/tools/search-files.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { editFileTool } from "../src/tools/edit-file.js";

// Regression coverage for the "uninformed first action" bug fix session:
// a model omitting a tool's arguments must never crash the process, and
// where a sensible default exists (list_directory with no path), it
// should succeed rather than error at all.
describe("tool input validation", () => {
  it("list_directory defaults to the current directory when path is omitted", async () => {
    const result = await listDirectoryTool.execute({});
    expect(result.error).toBeUndefined();
    expect(result.output).toBeTruthy();
  });

  it("read_file returns a clean error (not a throw) when path is missing", async () => {
    const result = await readFileTool.execute({});
    expect(result.error).toMatch(/requires a "path" string/);
  });

  it("read_multiple_files returns a clean error when paths is missing", async () => {
    const result = await readMultipleFilesTool.execute({});
    expect(result.error).toMatch(/requires a "paths" array/);
  });

  it("search_files returns a clean error when pattern is missing", async () => {
    const result = await searchFilesTool.execute({});
    expect(result.error).toMatch(/requires a "pattern" string/);
  });

  describe("null vs. undefined for required arguments", () => {
    // These are distinct JS values, and a naive `if (!input.path)` check
    // would treat "" the same as both — our guards use `typeof x !== "string"`
    // specifically so null is caught the same clean way undefined is.
    it("read_file: path explicitly null", async () => {
      const result = await readFileTool.execute({ path: null } as any);
      expect(result.error).toMatch(/requires a "path" string/);
    });

    it("write_file: path explicitly null", async () => {
      const result = await writeFileTool.execute({ path: null, content: "x" } as any);
      expect(result.error).toMatch(/requires a "path" string/);
    });

    it("write_file: content explicitly null (path valid)", async () => {
      const result = await writeFileTool.execute({ path: "a.txt", content: null } as any);
      expect(result.error).toMatch(/requires a "content" string/);
    });

    it("edit_file: old_string explicitly null", async () => {
      const result = await editFileTool.execute({ path: "a.txt", old_string: null, new_string: "x" } as any);
      expect(result.error).toMatch(/requires an "old_string" string/);
    });

    it("read_multiple_files: paths explicitly null", async () => {
      const result = await readMultipleFilesTool.execute({ paths: null } as any);
      expect(result.error).toMatch(/requires a "paths" array/);
    });

    it("search_files: pattern explicitly null", async () => {
      const result = await searchFilesTool.execute({ pattern: null } as any);
      expect(result.error).toMatch(/requires a "pattern" string/);
    });
  });

  describe("with a real temp directory", () => {
    let cwd: string;

    beforeAll(async () => {
      cwd = await mkdtemp(join(tmpdir(), "input-validation-test-"));
      await writeFile(join(cwd, "existing.txt"), "hello world\nhello again\n", "utf-8");
      await writeFile(join(cwd, "needle.txt"), "the needle is here\n", "utf-8");
      // A binary file in the search scope — must be skipped gracefully by
      // search_files, not treated as an error that aborts the whole search.
      await writeFile(join(cwd, "binary.dat"), Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 1]));
    });

    afterAll(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it("read_file on a nonexistent path: clean error mentioning the path, not a raw fs error leaking through", async () => {
      const result = await readFileTool.execute({ path: join(cwd, "does-not-exist.txt") });
      expect(result.error).toContain("does-not-exist.txt");
      expect(result.error).toMatch(/failed to read/i);
    });

    it("list_directory: omitted path defaults to \".\" and succeeds (cwd-relative)", async () => {
      const result = await listDirectoryTool.execute({});
      expect(result.error).toBeUndefined();
    });

    it("search_files: omitted path defaults to \".\" and succeeds", async () => {
      const result = await searchFilesTool.execute({ pattern: "hello" });
      expect(result.error).toBeUndefined();
    });

    it("search_files: scoped to the temp dir, finds the match and skips the binary file without erroring", async () => {
      const result = await searchFilesTool.execute({ pattern: "needle", path: cwd });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain("needle.txt");
    });

    it("search_files: zero matches returns a clean \"no matches\" result, not an error", async () => {
      const result = await searchFilesTool.execute({ pattern: "definitely-not-present-anywhere", path: cwd });
      expect(result.error).toBeUndefined();
      expect(result.output).toContain("no matches");
    });

    it("edit_file: old_string not found returns a clean error", async () => {
      const result = await editFileTool.execute({
        path: join(cwd, "existing.txt"),
        old_string: "not in the file",
        new_string: "x",
      });
      expect(result.error).toMatch(/old_string not found/);
    });

    it("edit_file: old_string appears more than once requires replace_all, doesn't silently edit the first match", async () => {
      const before = await readFile(join(cwd, "existing.txt"), "utf-8");
      const result = await editFileTool.execute({
        path: join(cwd, "existing.txt"),
        old_string: "hello",
        new_string: "goodbye",
      });
      expect(result.error).toMatch(/appears 2 times/);
      expect(result.error).toMatch(/replace_all/);
      // File must be untouched — no partial/silent edit happened.
      const after = await readFile(join(cwd, "existing.txt"), "utf-8");
      expect(after).toBe(before);
    });

    it("write_file: writing to a path whose parent directories don't exist yet creates them", async () => {
      const targetPath = join(cwd, "new", "nested", "dir", "file.txt");
      const result = await writeFileTool.execute({ path: targetPath, content: "created" });
      expect(result.error).toBeUndefined();
      const stats = await stat(targetPath);
      expect(stats.isFile()).toBe(true);
      expect(await readFile(targetPath, "utf-8")).toBe("created");
    });

    it("write_file: multi-line content with real newlines round-trips byte-for-byte", async () => {
      const targetPath = join(cwd, "roundtrip.json");
      const content = '{\n  "name": "bookmarks-api",\n  "version": "1.0.0"\n}';
      const result = await writeFileTool.execute({ path: targetPath, content });
      expect(result.error).toBeUndefined();
      const written = await readFile(targetPath, "utf-8");
      expect(written).toBe(content);
      expect(() => JSON.parse(written)).not.toThrow();
    });

    it("edit_file: multi-line new_string with real newlines round-trips byte-for-byte", async () => {
      const targetPath = join(cwd, "roundtrip-edit.txt");
      await writeFile(targetPath, "placeholder", "utf-8");
      const newContent = "line one\nline two\nline three";
      const result = await editFileTool.execute({ path: targetPath, old_string: "placeholder", new_string: newContent });
      expect(result.error).toBeUndefined();
      expect(await readFile(targetPath, "utf-8")).toBe(newContent);
    });

    it("write_file: refuses content that is double-escaped (literal \\n, no real newlines)", async () => {
      const targetPath = join(cwd, "corrupted.json");
      const corrupted = '{\\n  "name": "bookmarks-api",\\n  "version": "1.0.0"\\n}';
      const result = await writeFileTool.execute({ path: targetPath, content: corrupted });
      expect(result.error).toMatch(/literal.*\\n.*sequences/i);
      // Must not have written the corrupted content to disk.
      await expect(readFile(targetPath, "utf-8")).rejects.toThrow();
    });

    it("edit_file: refuses new_string that is double-escaped (literal \\n, no real newlines)", async () => {
      const targetPath = join(cwd, "corrupted-edit.txt");
      await writeFile(targetPath, "placeholder", "utf-8");
      const corrupted = "line one\\nline two\\nline three";
      const result = await editFileTool.execute({ path: targetPath, old_string: "placeholder", new_string: corrupted });
      expect(result.error).toMatch(/literal.*\\n.*sequences/i);
      expect(await readFile(targetPath, "utf-8")).toBe("placeholder");
    });

    it("write_file: a single literal \\n (e.g. documenting regex syntax) is not flagged as corruption", async () => {
      const targetPath = join(cwd, "one-escape.txt");
      const content = "the pattern uses \\n for newlines";
      const result = await writeFileTool.execute({ path: targetPath, content });
      expect(result.error).toBeUndefined();
      expect(await readFile(targetPath, "utf-8")).toBe(content);
    });
  });
});
