import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
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
});
