export interface ToolResult {
  output?: string;
  error?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (input: any) => Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

export interface CheckpointResult {
  action: "done" | "continue";
  message?: string;
}

// What the loop calls to run tools. Implemented directly by nothing in
// Phase 1 — Phase 2's Harness wraps a ToolRegistry and implements this,
// interposing approval gates, snapshotting, sandboxing, and checkpoint
// validation between the loop's decision to call a tool and it actually
// running.
export interface ToolExecutor {
  execute(name: string, input: any): Promise<ToolResult>;
  checkpoint(task: string): Promise<CheckpointResult>;
}
