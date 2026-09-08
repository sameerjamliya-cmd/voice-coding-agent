export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: any }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface NormalizedMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface NormalizedTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface NormalizedResponse {
  content: ContentBlock[];
  wantsToolCall: boolean;
}
