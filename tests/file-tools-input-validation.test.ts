import { describe, it, expect } from "vitest";
import { listDirectoryTool } from "../src/tools/list-directory.js";
import { readFileTool } from "../src/tools/read-file.js";
import { readMultipleFilesTool } from "../src/tools/read-multiple-files.js";
import { searchFilesTool } from "../src/tools/search-files.js";

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
});
