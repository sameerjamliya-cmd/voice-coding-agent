import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { LLMProvider } from "./provider.js";
import type { ContentBlock, NormalizedMessage, NormalizedResponse, NormalizedTool } from "./types.js";

const DEFAULT_MODEL = "gpt-4o";

// All OpenAI-specific code — SDK types, chat-completions message shape,
// function-calling tool schema, finish_reason semantics — is confined to
// this file. Everything outside llm/ talks only in normalized types.
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
    system: string
  ): Promise<NormalizedResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        ...messages.flatMap(toOpenAIMessages),
      ],
      tools: tools.map(toOpenAITool),
    });

    return fromOpenAICompletion(response);
  }
}

function toOpenAITool(tool: NormalizedTool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  };
}

// A single normalized message can expand into multiple OpenAI messages:
// tool results become one standalone `role: "tool"` message each, rather
// than staying nested inside the user turn the way Anthropic models them.
function toOpenAIMessages(message: NormalizedMessage): ChatCompletionMessageParam[] {
  if (message.role === "assistant") {
    const text = message.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const toolCalls: ChatCompletionMessageFunctionToolCall[] = message.content
      .filter((b): b is Extract<ContentBlock, { type: "tool_call" }> => b.type === "tool_call")
      .map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));

    return [
      {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    ];
  }

  const result: ChatCompletionMessageParam[] = [];

  const text = message.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (text) {
    result.push({ role: "user", content: text });
  }

  for (const block of message.content) {
    if (block.type === "tool_result") {
      result.push({ role: "tool", tool_call_id: block.toolCallId, content: block.content });
    }
  }

  return result;
}

function fromOpenAICompletion(response: OpenAI.Chat.Completions.ChatCompletion): NormalizedResponse {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new Error("OpenAI response contained no choices");
  }

  const content: ContentBlock[] = [];

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }

  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.type !== "function") continue;
    content.push({
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments),
    });
  }

  return {
    content,
    wantsToolCall: response.choices[0]?.finish_reason === "tool_calls",
  };
}
