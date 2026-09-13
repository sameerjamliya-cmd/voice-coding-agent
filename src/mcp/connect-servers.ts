import type { Tool, ToolInputSchema } from "../agent/types.js";
import type { McpConfig } from "./config.js";
import { McpServerConnection } from "./client.js";

export type McpEvent =
  | { type: "mcp_connected"; server: string; toolCount: number }
  | { type: "mcp_connection_failed"; server: string; error: string };

export interface ConnectedMcp {
  // Ready to merge straight into the same ToolRegistry as hand-built
  // tools — from the loop's perspective these are indistinguishable from
  // any other tool.
  tools: Tool[];
  // Registry tool name -> originating server name, for harness's approval
  // gating (these are gated even though read-only) and for source_server
  // observability logging.
  sourceServers: Map<string, string>;
  close(): Promise<void>;
}

// Registered tool names are namespaced <server>__<tool> — an MCP server's
// tool can share a name with a hand-built tool (e.g. GitHub's read_file
// vs. the local filesystem read_file) without colliding in the registry,
// and without the two being confusable to Claude.
export function mcpToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

export async function connectMcpServers(config: McpConfig, onEvent?: (event: McpEvent) => void): Promise<ConnectedMcp> {
  const tools: Tool[] = [];
  const sourceServers = new Map<string, string>();
  const connections: McpServerConnection[] = [];

  for (const serverConfig of config.servers) {
    try {
      const connection = await McpServerConnection.connect(serverConfig);
      connections.push(connection);

      const discovered = await connection.discoverAllowedTools(serverConfig.allowedTools);
      for (const remoteTool of discovered) {
        const name = mcpToolName(serverConfig.name, remoteTool.name);
        sourceServers.set(name, serverConfig.name);
        tools.push({
          name,
          description: `[${serverConfig.name} MCP server] ${remoteTool.description}`,
          inputSchema: asObjectSchema(remoteTool.inputSchema),
          execute: (input: any) => connection.callTool(remoteTool.name, input),
        });
      }

      onEvent?.({ type: "mcp_connected", server: serverConfig.name, toolCount: discovered.length });
    } catch (err: any) {
      // A server being unreachable shouldn't take down the whole agent —
      // it just means that server's tools aren't available this run.
      onEvent?.({ type: "mcp_connection_failed", server: serverConfig.name, error: err.message });
    }
  }

  return {
    tools,
    sourceServers,
    close: async () => {
      await Promise.all(connections.map((c) => c.close()));
    },
  };
}

function asObjectSchema(schema: unknown): ToolInputSchema {
  if (schema && typeof schema === "object" && (schema as any).type === "object") {
    return schema as ToolInputSchema;
  }
  return { type: "object", properties: {} };
}
