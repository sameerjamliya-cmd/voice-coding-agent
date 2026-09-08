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

export type SessionEndStatus = "completed" | "abandoned" | "max_iterations";

export interface TokenBudgetResult {
  action: "continue" | "stop";
  message?: string;
}

// What the loop calls to run tools. Implemented directly by nothing in
// Phase 1 — Phase 2's Harness wraps a ToolRegistry and implements this,
// interposing approval gates, snapshotting, sandboxing, and checkpoint
// validation between the loop's decision to call a tool and it actually
// running. recordIteration/endSession/checkTokenBudget are optional: they
// exist only so the loop can report session-level bookkeeping (round-trip
// count, final status, token usage) to an observability/budget layer that
// isn't part of Phase 1's contract.
export interface ToolExecutor {
  execute(name: string, input: any): Promise<ToolResult>;
  checkpoint(task: string): Promise<CheckpointResult>;
  recordIteration?(): void;
  endSession?(status: SessionEndStatus): Promise<void>;
  checkTokenBudget?(usage: { inputTokens: number; outputTokens: number }): Promise<TokenBudgetResult>;
}
