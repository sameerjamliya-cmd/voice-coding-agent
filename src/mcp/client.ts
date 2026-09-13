import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "./config.js";

export interface McpDiscoveredTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpCallResult {
  output?: string;
  error?: string;
}

// Generic MCP client wrapper — nothing here is specific to any one server.
// GitHub, docs-search, or a future third server all go through the exact
// same connect/discover/call code path; only the config entry differs.
export class McpServerConnection {
  private constructor(
    readonly serverName: string,
    private client: Client
  ) {}

  static async connect(config: McpServerConfig): Promise<McpServerConnection> {
    const client = new Client({ name: "voice-coding-agent", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(config.url));
    await client.connect(transport);
    return new McpServerConnection(config.name, client);
  }

  // Tools not present in `allowedTools` are never returned from here —
  // invisible to everything downstream, not merely gated. A server may
  // expose far more than this; only the allowlisted subset ever exists
  // from the agent's point of view.
  async discoverAllowedTools(allowedTools: string[]): Promise<McpDiscoveredTool[]> {
    const allowedSet = new Set(allowedTools);
    const { tools } = await this.client.listTools();
    return tools
      .filter((tool) => allowedSet.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      }));
  }

  async callTool(name: string, input: unknown): Promise<McpCallResult> {
    try {
      const result = await this.client.callTool({ name, arguments: input as Record<string, unknown> });
      const text = extractText(result.content);
      return result.isError ? { error: text } : { output: text };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((block) => (block && typeof block === "object" && block.type === "text" ? block.text : JSON.stringify(block)))
    .join("\n");
}
