import { describe, it, expect } from "vitest";
import { normalizeRunCommand, normalizeToolCall } from "../src/harness/normalize.js";

const cwd = "/tmp/proj";

describe("normalizeRunCommand", () => {
  it("collapses npm run <script> and npm <script> to the same key", () => {
    expect(normalizeRunCommand("npm test", cwd)).toBe(normalizeRunCommand("npm run test", cwd));
  });

  it("collapses relative and ./-prefixed rm targets to the same key", () => {
    expect(normalizeRunCommand("rm -rf node_modules", cwd)).toBe(
      normalizeRunCommand("rm -rf ./node_modules", cwd)
    );
  });

  it("treats different rm targets as different keys", () => {
    expect(normalizeRunCommand("rm -rf node_modules", cwd)).not.toBe(
      normalizeRunCommand("rm -rf src", cwd)
    );
  });

  it("treats bundled short flags as order-independent", () => {
    expect(normalizeRunCommand("rm -rf node_modules", cwd)).toBe(
      normalizeRunCommand("rm -fr node_modules", cwd)
    );
  });

  it("flag-order insensitivity applies generally, not just to rm (e.g. ls -la vs ls -al)", () => {
    expect(normalizeRunCommand("ls -la", cwd)).toBe(normalizeRunCommand("ls -al", cwd));
  });

  it("does NOT collapse superficially similar but distinct rm targets sharing a prefix", () => {
    // Guards against a substring/prefix-based normalization bug — these
    // are two genuinely different directories, not the same target
    // written two ways.
    expect(normalizeRunCommand("rm -rf node_modules", cwd)).not.toBe(
      normalizeRunCommand("rm -rf node_modules_backup", cwd)
    );
  });
});

describe("normalizeToolCall", () => {
  it("normalizes write_file to tool + resolved absolute path", () => {
    expect(normalizeToolCall("write_file", { path: "src/utils.ts" }, cwd)).toBe(
      normalizeToolCall("write_file", { path: "./src/utils.ts" }, cwd)
    );
  });

  it("treats edits to different files as different keys", () => {
    expect(normalizeToolCall("write_file", { path: "a.ts" }, cwd)).not.toBe(
      normalizeToolCall("write_file", { path: "b.ts" }, cwd)
    );
  });

  it("normalizes MCP-sourced tools (name containing __) by name only, ignoring arguments", () => {
    const a = normalizeToolCall("github__search_code", { query: "TODO" }, cwd);
    const b = normalizeToolCall("github__search_code", { query: "FIXME" }, cwd);
    expect(a).toBe(b);
  });

  it("edit_file: same file across two calls with different edit content normalizes to the same key", () => {
    // File identity is what matters for this tool's approval memory —
    // once you've approved editing a file, further edits to that same
    // file shouldn't re-prompt just because the specific change differs.
    const a = normalizeToolCall(
      "edit_file",
      { path: "src/utils.ts", old_string: "foo", new_string: "bar" },
      cwd
    );
    const b = normalizeToolCall(
      "edit_file",
      { path: "src/utils.ts", old_string: "baz", new_string: "qux" },
      cwd
    );
    expect(a).toBe(b);
  });

  it("edit_file: different files must never normalize to the same key", () => {
    const a = normalizeToolCall("edit_file", { path: "src/utils.ts", old_string: "x", new_string: "y" }, cwd);
    const b = normalizeToolCall("edit_file", { path: "package.json", old_string: "x", new_string: "y" }, cwd);
    expect(a).not.toBe(b);
  });

  it("does NOT collapse two different relative paths that happen to share a prefix", () => {
    const a = normalizeToolCall("write_file", { path: "src/auth.ts" }, cwd);
    const b = normalizeToolCall("write_file", { path: "src/auth-legacy.ts" }, cwd);
    expect(a).not.toBe(b);
  });
});

// 40 command/path pairs: 20 that must normalize to the SAME key (cosmetic
// variation — auto-approve should treat these as the same action) and 20
// that must normalize to DIFFERENT keys (a real difference in target or
// scope — must never cross-approve). Each row exercises a distinct
// surface: flag order/bundling, relative vs. equivalent path forms,
// similar-but-different paths, and similar-but-different rm targets.
interface NormalizePair {
  label: string;
  a: { tool: string; input: any };
  b: { tool: string; input: any };
}

const SAME_KEY_PAIRS: NormalizePair[] = [
  {
    label: "npm test vs npm run test",
    a: { tool: "run_command", input: { command: "npm test" } },
    b: { tool: "run_command", input: { command: "npm run test" } },
  },
  {
    label: "npm run build vs npm build",
    a: { tool: "run_command", input: { command: "npm run build" } },
    b: { tool: "run_command", input: { command: "npm build" } },
  },
  {
    label: "rm -rf vs rm -fr (flag bundling order)",
    a: { tool: "run_command", input: { command: "rm -rf logs" } },
    b: { tool: "run_command", input: { command: "rm -fr logs" } },
  },
  {
    label: "ls -la vs ls -al",
    a: { tool: "run_command", input: { command: "ls -la" } },
    b: { tool: "run_command", input: { command: "ls -al" } },
  },
  {
    label: "chmod -rf vs chmod -fr on same target",
    a: { tool: "run_command", input: { command: "chmod -rf ./scripts" } },
    b: { tool: "run_command", input: { command: "chmod -fr ./scripts" } },
  },
  {
    label: "rm target: bare relative vs ./-prefixed",
    a: { tool: "run_command", input: { command: "rm -rf node_modules" } },
    b: { tool: "run_command", input: { command: "rm -rf ./node_modules" } },
  },
  {
    label: "mv target: bare relative vs ./-prefixed source",
    a: { tool: "run_command", input: { command: "mv old.txt new.txt" } },
    b: { tool: "run_command", input: { command: "mv ./old.txt ./new.txt" } },
  },
  {
    label: "write_file: bare relative vs ./-prefixed path",
    a: { tool: "write_file", input: { path: "src/index.ts" } },
    b: { tool: "write_file", input: { path: "./src/index.ts" } },
  },
  {
    label: "edit_file: same file, different old_string/new_string content",
    a: { tool: "edit_file", input: { path: "a.ts", old_string: "1", new_string: "2" } },
    b: { tool: "edit_file", input: { path: "a.ts", old_string: "3", new_string: "4" } },
  },
  {
    label: "delete_file: bare relative vs ./-prefixed path",
    a: { tool: "delete_file", input: { path: "tmp.log" } },
    b: { tool: "delete_file", input: { path: "./tmp.log" } },
  },
  {
    label: "create_directory: bare relative vs ./-prefixed path",
    a: { tool: "create_directory", input: { path: "out" } },
    b: { tool: "create_directory", input: { path: "./out" } },
  },
  {
    label: "move_file: identical from/to via ./-prefixed form",
    a: { tool: "move_file", input: { from: "a.ts", to: "b.ts" } },
    b: { tool: "move_file", input: { from: "./a.ts", to: "./b.ts" } },
  },
  {
    label: "MCP tool: same tool, different query arguments",
    a: { tool: "github__search_code", input: { query: "foo" } },
    b: { tool: "github__search_code", input: { query: "bar" } },
  },
  {
    label: "MCP tool: same tool, completely different input shape",
    a: { tool: "docs__lookup", input: { term: "x" } },
    b: { tool: "docs__lookup", input: { page: 2, filters: ["a"] } },
  },
  {
    label: "cp target: bare relative vs ./-prefixed",
    a: { tool: "run_command", input: { command: "cp a.txt b.txt" } },
    b: { tool: "run_command", input: { command: "cp ./a.txt ./b.txt" } },
  },
  {
    label: "mkdir target: bare relative vs ./-prefixed",
    a: { tool: "run_command", input: { command: "mkdir newdir" } },
    b: { tool: "run_command", input: { command: "mkdir ./newdir" } },
  },
  {
    label: "rmdir target: bare relative vs ./-prefixed",
    a: { tool: "run_command", input: { command: "rmdir olddir" } },
    b: { tool: "run_command", input: { command: "rmdir ./olddir" } },
  },
  {
    label: "touch target: bare relative vs ./-prefixed",
    a: { tool: "run_command", input: { command: "touch marker" } },
    b: { tool: "run_command", input: { command: "touch ./marker" } },
  },
  {
    label: "git status flags: -s vs --short is out of scope, but repeated call with no args is identical",
    a: { tool: "run_command", input: { command: "git status" } },
    b: { tool: "run_command", input: { command: "git status" } },
  },
  {
    label: "npm run lint vs npm lint",
    a: { tool: "run_command", input: { command: "npm run lint" } },
    b: { tool: "run_command", input: { command: "npm lint" } },
  },
];

const DIFFERENT_KEY_PAIRS: NormalizePair[] = [
  {
    label: "rm targets sharing a prefix: node_modules vs node_modules_backup",
    a: { tool: "run_command", input: { command: "rm -rf node_modules" } },
    b: { tool: "run_command", input: { command: "rm -rf node_modules_backup" } },
  },
  {
    label: "rm -rf src vs rm -rf source",
    a: { tool: "run_command", input: { command: "rm -rf src" } },
    b: { tool: "run_command", input: { command: "rm -rf source" } },
  },
  {
    label: "rm -rf dist vs rm -rf dist-old",
    a: { tool: "run_command", input: { command: "rm -rf dist" } },
    b: { tool: "run_command", input: { command: "rm -rf dist-old" } },
  },
  {
    label: "write_file: two different files",
    a: { tool: "write_file", input: { path: "a.ts" } },
    b: { tool: "write_file", input: { path: "b.ts" } },
  },
  {
    label: "write_file: similar-but-different filenames sharing a prefix",
    a: { tool: "write_file", input: { path: "src/auth.ts" } },
    b: { tool: "write_file", input: { path: "src/auth-legacy.ts" } },
  },
  {
    label: "edit_file: two different files",
    a: { tool: "edit_file", input: { path: "src/utils.ts", old_string: "x", new_string: "y" } },
    b: { tool: "edit_file", input: { path: "package.json", old_string: "x", new_string: "y" } },
  },
  {
    label: "delete_file: two different files",
    a: { tool: "delete_file", input: { path: "keep.txt" } },
    b: { tool: "delete_file", input: { path: "delete.txt" } },
  },
  {
    label: "create_directory: two different directories",
    a: { tool: "create_directory", input: { path: "out" } },
    b: { tool: "create_directory", input: { path: "output" } },
  },
  {
    label: "move_file: same 'from', different 'to'",
    a: { tool: "move_file", input: { from: "a.ts", to: "b.ts" } },
    b: { tool: "move_file", input: { from: "a.ts", to: "c.ts" } },
  },
  {
    label: "move_file: different 'from', same 'to'",
    a: { tool: "move_file", input: { from: "a.ts", to: "z.ts" } },
    b: { tool: "move_file", input: { from: "b.ts", to: "z.ts" } },
  },
  {
    label: "MCP tools: different tool names on the same server",
    a: { tool: "github__search_code", input: { query: "same" } },
    b: { tool: "github__read_file", input: { query: "same" } },
  },
  {
    label: "MCP tools: different server, same tool suffix",
    a: { tool: "github__search", input: { query: "same" } },
    b: { tool: "gitlab__search", input: { query: "same" } },
  },
  {
    label: "run_command: different commands entirely",
    a: { tool: "run_command", input: { command: "npm test" } },
    b: { tool: "run_command", input: { command: "npm run build" } },
  },
  {
    label: "run_command: mv with swapped source/dest",
    a: { tool: "run_command", input: { command: "mv a.ts b.ts" } },
    b: { tool: "run_command", input: { command: "mv b.ts a.ts" } },
  },
  {
    label: "run_command: cp targeting different destinations",
    a: { tool: "run_command", input: { command: "cp a.txt dest1.txt" } },
    b: { tool: "run_command", input: { command: "cp a.txt dest2.txt" } },
  },
  {
    label: "run_command: same base command, different flags entirely",
    a: { tool: "run_command", input: { command: "git push" } },
    b: { tool: "run_command", input: { command: "git push --force" } },
  },
  {
    label: "run_command: touch on two different files",
    a: { tool: "run_command", input: { command: "touch a.marker" } },
    b: { tool: "run_command", input: { command: "touch b.marker" } },
  },
  {
    label: "run_command: mkdir of two different directories",
    a: { tool: "run_command", input: { command: "mkdir dir1" } },
    b: { tool: "run_command", input: { command: "mkdir dir2" } },
  },
  {
    label: "same tool name, no hand-written rule, different full input (falls back to JSON.stringify)",
    a: { tool: "custom_unregistered_tool", input: { x: 1 } },
    b: { tool: "custom_unregistered_tool", input: { x: 2 } },
  },
  {
    label: "different tool entirely on the same path",
    a: { tool: "write_file", input: { path: "a.ts" } },
    b: { tool: "edit_file", input: { path: "a.ts", old_string: "x", new_string: "y" } },
  },
];

describe("normalizeToolCall — same-key pairs (parametrized)", () => {
  it.each(SAME_KEY_PAIRS.map((p) => [p.label, p] as const))("%s: normalizes to the SAME key", (_label, pair) => {
    const keyA = normalizeToolCall(pair.a.tool, pair.a.input, cwd);
    const keyB = normalizeToolCall(pair.b.tool, pair.b.input, cwd);
    expect(keyA).toBe(keyB);
  });
});

describe("normalizeToolCall — different-key pairs (parametrized)", () => {
  it.each(DIFFERENT_KEY_PAIRS.map((p) => [p.label, p] as const))(
    "%s: normalizes to DIFFERENT keys",
    (_label, pair) => {
      const keyA = normalizeToolCall(pair.a.tool, pair.a.input, cwd);
      const keyB = normalizeToolCall(pair.b.tool, pair.b.input, cwd);
      expect(keyA).not.toBe(keyB);
    }
  );
});
