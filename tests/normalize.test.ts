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
