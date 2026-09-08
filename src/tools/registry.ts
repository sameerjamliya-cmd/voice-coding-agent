import type { Tool, ToolResult } from "../agent/types.js";
import type { NormalizedTool } from "../llm/types.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  toNormalizedTools(): NormalizedTool[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(name: string, input: any): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Unknown tool: "${name}"` };
    }
    try {
      return await tool.execute(input);
    } catch (err: any) {
      return { error: err?.message ?? String(err) };
    }
  }
}
