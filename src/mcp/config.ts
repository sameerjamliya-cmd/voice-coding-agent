import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface McpServerConfig {
  name: string;
  url: string;
  allowedTools: string[];
}

export interface McpConfig {
  servers: McpServerConfig[];
}

// No server gets hardcoded here — every connected server, GitHub included,
// is just an entry in this config file. Adding a third server later is a
// config change, not a code change.
export async function loadMcpConfig(cwd: string): Promise<McpConfig> {
  try {
    const raw = await readFile(join(cwd, ".voice-agent", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return { servers: Array.isArray(parsed.servers) ? parsed.servers : [] };
  } catch {
    return { servers: [] };
  }
}
