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
});
