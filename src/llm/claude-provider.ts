import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./provider.js";
import type { ContentBlock, NormalizedMessage, NormalizedResponse, NormalizedTool } from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-5";

type AnthropicContentBlockParam = Exclude<
  Anthropic.MessageParam["content"],
  string
>[number];

// All Anthropic-specific code — SDK types, message shape, tool schema shape,
// stop_reason semantics — is confined to this file. Everything outside
// llm/ talks only in normalized types.
export class ClaudeProvider implements LLMProvider {
  name = "claude";

  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(
    messages: NormalizedMessage[],
    tools: NormalizedTool[],
    system: string
  ): Promise<NormalizedResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: messages.map(toAnthropicMessage),
      tools: tools.map(toAnthropicTool),
      // Harness only ever acts on the first tool_use block in a response
      // (see loop.ts) — this is a best-effort API-level hint toward that
      // same behavior, not a substitute for the harness-level enforcement.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });

    return fromAnthropicResponse(response);
  }
}

function toAnthropicTool(tool: NormalizedTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function toAnthropicMessage(message: NormalizedMessage): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.map(toAnthropicBlock),
  };
}

function toAnthropicBlock(block: ContentBlock): AnthropicContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_call":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolCallId,
        content: block.content,
        is_error: block.isError,
      };
  }
}

function fromAnthropicResponse(response: Anthropic.Message): NormalizedResponse {
  const content: ContentBlock[] = response.content.map((block): ContentBlock => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "tool_use") {
      return { type: "tool_call", id: block.id, name: block.name, input: block.input };
    }
    throw new Error(`Unsupported Anthropic content block type: "${(block as { type: string }).type}"`);
  });

  return {
    content,
    wantsToolCall: response.stop_reason === "tool_use",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
