import OpenAI from "openai";
import type {
  Response,
  ResponseInputItem,
  ResponseOutputItem,
  Tool as ResponsesTool,
} from "openai/resources/responses/responses";
import type { LLMProvider } from "./provider.js";
import type { ContentBlock, NormalizedMessage, NormalizedResponse, NormalizedTool } from "./types.js";

const DEFAULT_MODEL = "gpt-4o";

// All OpenAI-specific code — SDK types, Responses API item shape,
// function-calling tool schema, output-item semantics — is confined to
// this file. Everything outside llm/ talks only in normalized types.
//
// Uses /v1/responses (client.responses.create), not /v1/chat/completions.
// The full conversation is replayed as `input` items on every call (like
// the Anthropic provider replays `messages`) rather than relying on
// `previous_response_id` — this keeps the provider stateless the same way
// ClaudeProvider is, with no server-side conversation state to manage.
export class OpenAIProvider implements LLMProvider {
  name = "openai";

  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async complete(
    messages: NormalizedMessage[],
    tools: NormalizedTool[],
    system: string,
    signal?: AbortSignal
  ): Promise<NormalizedResponse> {
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: system,
        input: messages.flatMap(toResponsesInputItems),
        tools: tools.map(toResponsesTool),
        // Harness only ever acts on the first tool call in a response (see
        // loop.ts) — this is a best-effort API-level hint toward that same
        // behavior, not a substitute for the harness-level enforcement.
        parallel_tool_calls: false,
      },
      { signal }
    );

    return fromResponsesAPI(response);
  }
}

function toResponsesTool(tool: NormalizedTool): ResponsesTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as Record<string, unknown>,
    strict: false,
  };
}

// A single normalized message can expand into multiple Responses API input
// items: a tool_call becomes a standalone `function_call` item and a
// tool_result becomes a standalone `function_call_output` item, each
// correlated back to its call via `call_id` — mirroring how the
// chat-completions provider expands a tool result into its own `role:
// "tool"` message rather than nesting it inside the turn.
function toResponsesInputItems(message: NormalizedMessage): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];

  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      items.push({ role: message.role, content: block.text });
    } else if (block.type === "tool_call") {
      items.push({
        type: "function_call",
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      });
    } else if (block.type === "tool_result") {
      items.push({
        type: "function_call_output",
        call_id: block.toolCallId,
        output: block.content,
      });
    }
  }

  return items;
}

function fromResponsesAPI(response: Response): NormalizedResponse {
  const content: ContentBlock[] = [];
  let wantsToolCall = false;

  for (const item of response.output) {
    if (isMessageItem(item)) {
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      wantsToolCall = true;
      content.push({
        type: "tool_call",
        id: item.call_id,
        name: item.name,
        input: item.arguments ? JSON.parse(item.arguments) : {},
      });
    }
  }

  return {
    content,
    wantsToolCall,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

function isMessageItem(item: ResponseOutputItem): item is Extract<ResponseOutputItem, { type: "message" }> {
  return item.type === "message";
}
