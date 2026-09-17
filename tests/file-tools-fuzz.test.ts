import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "../src/tools/read-file.js";
import { writeFileTool } from "../src/tools/write-file.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { listDirectoryTool } from "../src/tools/list-directory.js";
import { searchFilesTool } from "../src/tools/search-files.js";
import { deleteFileTool } from "../src/tools/delete-file.js";
import { moveFileTool } from "../src/tools/move-file.js";
import type { Tool, ToolResult } from "../src/agent/types.js";

// Fixed seed — the generated values are still genuinely diverse (fast-check's
// real generation strategy, not a hand-picked list), but a fixed seed keeps
// the exact sample set (and therefore the exact set of reported test titles)
// stable across runs rather than reshuffling every time this file executes.
const SEED = 20260101;
const CORE_NUM_SAMPLES = 45;
// search_files spawns a real grep subprocess per case (unlike the other
// tools, which are pure in-process fs calls) — a real, measurable per-case
// cost, so this uses a smaller sample per the spec's own "reduce numRuns
// rather than cut coverage elsewhere" guidance.
const SEARCH_FILES_NUM_SAMPLES = 15;
const GENERIC_SWEEP_NUM_SAMPLES = 20;

// Property-based coverage of the path-accepting tools' input space.
// write_file/edit_file/move_file/delete_file perform REAL filesystem
// operations with no path sandboxing of their own (see write-file.ts's
// own comment: a relative path resolves against process.cwd(), not any
// harness-scoped directory) — so a generated path-traversal string
// (fast-check deliberately produces these, per the malformed-input
// generator below) must never be allowed to touch anything outside a
// disposable sandbox. Every test in this file runs with process.cwd()
// pointed at a fresh temp directory for exactly that reason; this is the
// same mitigation runner.ts uses for the real agent loop, applied here
// for the same reason.
let sandboxDir: string;
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  sandboxDir = await mkdtemp(join(tmpdir(), "file-tools-fuzz-"));
  process.chdir(sandboxDir);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(sandboxDir, { recursive: true, force: true });
});

// The generated malformed/edge-case input space: wrong types entirely,
// empty and very long strings, unicode/emoji, and deliberate path-
// traversal/injection attempts. fc.sample() below draws concrete values
// from this generator — each one genuinely distinct, produced by
// fast-check's real generation strategy, not a hand-listed table — and
// wires them through it.each so every sampled case is its own reported
// test, not just an internal iteration hidden inside one assertion.
const malformedPathInput = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.string()),
  fc.constant({}),
  fc.string({ minLength: 0, maxLength: 0 }), // empty string
  fc.string({ minLength: 5000, maxLength: 10000 }), // very long
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 200 }), // unicode/emoji
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => "../".repeat(20) + s), // path traversal
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => "\0" + s), // embedded NUL
  fc.string({ minLength: 1, maxLength: 40 }) // shell-metacharacter-laden
    .map((s) => `' ; touch /tmp/pwned-${s} ; echo '`)
);

function sampleInputs(count: number): unknown[] {
  return fc.sample(malformedPathInput, { numRuns: count, seed: SEED });
}

// A short, safe-for-a-test-title label — the raw sampled value can be
// huge (the 5000-10000 char case), non-string, or contain control
// characters, none of which belong in a reporter title.
function titleFor(value: unknown, index: number): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const preview = (raw ?? "undefined").replace(/[\x00-\x1f]/g, "\\?").slice(0, 40);
  return `#${index + 1} ${preview}${(raw?.length ?? 0) > 40 ? "…" : ""}`;
}

function assertCleanResult(result: ToolResult) {
  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
  // Never both, never neither would also be suspicious, but the hard
  // requirement per the tools' own contract is just: it resolved to one
  // of these two shapes, not a thrown exception.
  expect(result.output !== undefined || result.error !== undefined).toBe(true);
  if (result.error !== undefined) expect(typeof result.error).toBe("string");
  if (result.output !== undefined) expect(typeof result.output).toBe("string");
}

const CORE_SAMPLES = sampleInputs(CORE_NUM_SAMPLES).map((v, i) => [titleFor(v, i), v] as const);
const SEARCH_SAMPLES = sampleInputs(SEARCH_FILES_NUM_SAMPLES).map((v, i) => [titleFor(v, i), v] as const);

describe("file tools never throw on malformed input (property-based, one reported case per generated sample)", () => {
  describe("read_file — malformed path", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeInput) => {
      const result = await readFileTool.execute({ path: maybeInput as any });
      assertCleanResult(result);
    });
  });

  describe("write_file — malformed path (content held valid)", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeInput) => {
      const result = await writeFileTool.execute({ path: maybeInput as any, content: "fuzz-content" });
      assertCleanResult(result);
    });
  });

  describe("write_file — malformed content (path held valid)", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeContent) => {
      const result = await writeFileTool.execute({ path: "fuzz-target.txt", content: maybeContent as any });
      assertCleanResult(result);
    });
  });

  describe("edit_file — malformed path", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeInput) => {
      const result = await editFileTool.execute({ path: maybeInput as any, old_string: "x", new_string: "y" });
      assertCleanResult(result);
    });
  });

  describe("list_directory — malformed path", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeInput) => {
      const result = await listDirectoryTool.execute({ path: maybeInput as any });
      assertCleanResult(result);
    });
  });

  describe("delete_file — malformed path", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeInput) => {
      const result = await deleteFileTool.execute({ path: maybeInput as any });
      assertCleanResult(result);
    });
  });

  describe("move_file — malformed 'from' ('to' held valid)", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeFrom) => {
      const result = await moveFileTool.execute({ from: maybeFrom as any, to: "fuzz-dest.txt" });
      assertCleanResult(result);
    });
  });

  describe("move_file — malformed 'to' ('from' held valid)", () => {
    it.each(CORE_SAMPLES)("%s", async (_title, maybeTo) => {
      const result = await moveFileTool.execute({ from: "fuzz-source-does-not-exist.txt", to: maybeTo as any });
      assertCleanResult(result);
    });
  });

  describe("search_files — malformed path (pattern held valid)", () => {
    it.each(SEARCH_SAMPLES)(
      "%s",
      async (_title, maybeInput) => {
        const result = await searchFilesTool.execute({ pattern: "fuzz", path: maybeInput as any });
        assertCleanResult(result);
      },
      10000
    );
  });

  describe("search_files — malformed pattern", () => {
    it.each(SEARCH_SAMPLES)(
      "%s",
      async (_title, maybePattern) => {
        const result = await searchFilesTool.execute({ pattern: maybePattern as any });
        assertCleanResult(result);
      },
      10000
    );
  });

  // Regression coverage for the shell-injection vulnerability found and
  // fixed while writing this fuzz suite: search_files previously
  // interpolated `path` directly into a shell command string with only
  // `pattern` escaped, so a path containing `'; <command>; '` could break
  // out of the quoting and execute arbitrary shell commands. Now uses
  // execFile with an argument array, so path/pattern reach grep as
  // literal argv entries and can never reach a shell parser.
  it("search_files does not execute shell metacharacters embedded in path or pattern", async () => {
    const marker = join(sandboxDir, `injection-marker-${Date.now()}`);
    const maliciousPath = `' ; touch ${marker} ; echo '`;
    await searchFilesTool.execute({ pattern: "anything", path: maliciousPath });
    await searchFilesTool.execute({ pattern: maliciousPath, path: "." });

    const { access } = await import("node:fs/promises");
    await expect(access(marker)).rejects.toThrow();
  });
});

// A generic runner over every path-accepting tool with a second,
// independent generator (arbitrary unicode strings rather than the
// malformed-type space above), so a new tool added later to this list
// gets the same property automatically rather than needing its own
// hand-written block.
const PATH_ACCEPTING_TOOLS: Array<{ tool: Tool; validInput: Record<string, unknown> }> = [
  { tool: readFileTool, validInput: { path: "x" } },
  { tool: listDirectoryTool, validInput: { path: "x" } },
  { tool: deleteFileTool, validInput: { path: "x" } },
];

const UNICODE_SAMPLES = fc
  .sample(fc.string({ unit: "grapheme", minLength: 0, maxLength: 100 }), { numRuns: GENERIC_SWEEP_NUM_SAMPLES, seed: SEED })
  .map((v, i) => [titleFor(v, i), v] as const);

describe("generic sweep: registered path-accepting tools stay well-behaved under arbitrary unicode paths", () => {
  for (const { tool, validInput } of PATH_ACCEPTING_TOOLS) {
    describe(`${tool.name} — arbitrary unicode path`, () => {
      it.each(UNICODE_SAMPLES)("%s", async (_title, arbitraryPath) => {
        const result = await tool.execute({ ...validInput, path: arbitraryPath });
        assertCleanResult(result);
      });
    });
  }
});
