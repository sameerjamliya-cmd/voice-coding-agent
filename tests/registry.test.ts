import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { buildRegistry } from "../src/tools/build-registry.js";
import type { Tool } from "../src/agent/types.js";

function makeTool(name: string, output = "ok"): Tool {
  return {
    name,
    description: `test tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ output }),
  };
}

describe("ToolRegistry", () => {
  it("executes a registered tool by name", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("foo", "hello"));
    const result = await registry.execute("foo", {});
    expect(result.output).toBe("hello");
  });

  it("returns an error for an unknown tool instead of throwing", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute("does_not_exist", {});
    expect(result.error).toMatch(/unknown tool/i);
  });

  it("catches a throwing tool and returns a ToolResult error, not an unhandled exception", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      description: "always throws",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const result = await registry.execute("boom", {});
    expect(result.error).toBe("kaboom");
  });

  it("rejects registering two tools with the same name", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("dup"));
    expect(() => registry.register(makeTool("dup"))).toThrow(/already registered/i);
  });

  it("converts registered tools to the normalized tool schema", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("foo"));
    const normalized = registry.toNormalizedTools();
    expect(normalized).toEqual([
      { name: "foo", description: "test tool foo", inputSchema: { type: "object", properties: {} } },
    ]);
  });

  it("converts every registered tool when multiple are present, preserving name/description/inputSchema per tool", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("foo"));
    registry.register(makeTool("bar"));
    const normalized = registry.toNormalizedTools();
    expect(normalized).toHaveLength(2);
    expect(normalized.map((t) => t.name).sort()).toEqual(["bar", "foo"]);
    for (const tool of normalized) {
      expect(tool.description).toBe(`test tool ${tool.name}`);
      expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
    }
  });

  it("getAll() returns an empty array for a fresh registry", () => {
    const registry = new ToolRegistry();
    expect(registry.getAll()).toEqual([]);
  });

  it("getAll() returns every registered tool object for a populated registry", () => {
    const registry = new ToolRegistry();
    const foo = makeTool("foo");
    const bar = makeTool("bar");
    registry.register(foo);
    registry.register(bar);
    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getAll()).toEqual(expect.arrayContaining([foo, bar]));
  });
});

// Generated from the real, live tool registry — exactly as cli.ts/
// benchmark/runner.ts construct it via buildRegistry — rather than a
// hand-maintained list of tool names that would drift out of sync as
// tools are added or removed. Each check below runs once per real
// registered tool via it.each, so this scales automatically.
describe("every real registered tool (generated from buildRegistry at test time)", () => {
  const realRegistry = buildRegistry([], []);
  const realTools = realRegistry.getAll();
  const realNormalized = realRegistry.toNormalizedTools();

  it("found at least one registered tool (sanity check that buildRegistry itself isn't broken)", () => {
    expect(realTools.length).toBeGreaterThan(0);
  });

  it.each(realTools.map((t) => [t.name, t] as const))("%s: name is non-empty", (_name, tool) => {
    expect(tool.name.length).toBeGreaterThan(0);
  });

  it("every registered tool has a unique name", () => {
    const names = realTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(realTools.map((t) => [t.name, t] as const))("%s: description is non-empty", (_name, tool) => {
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it.each(realTools.map((t) => [t.name, t] as const))("%s: inputSchema is a valid JSON-schema-shaped object", (_name, tool) => {
    expect(tool.inputSchema).toBeTruthy();
    expect(tool.inputSchema.type).toBe("object");
    if (tool.inputSchema.properties !== undefined) {
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
    if (tool.inputSchema.required !== undefined) {
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it.each(realTools.map((t) => [t.name, t] as const))(
    "%s: appears in toNormalizedTools() output with matching name/description/inputSchema",
    (name, tool) => {
      const normalized = realNormalized.find((n) => n.name === name);
      expect(normalized, `expected "${name}" to appear in toNormalizedTools() output`).toBeDefined();
      expect(normalized!.description).toBe(tool.description);
      expect(normalized!.inputSchema).toEqual(tool.inputSchema);
    }
  );
});
