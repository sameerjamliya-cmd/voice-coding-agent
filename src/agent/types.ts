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
