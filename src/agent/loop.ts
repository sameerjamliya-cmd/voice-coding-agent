import type { LLMProvider } from "../llm/provider.js";
import type { ContentBlock, NormalizedMessage } from "../llm/types.js";
import type { ToolExecutor } from "./types.js";
import type { ToolRegistry } from "../tools/registry.js";

const SYSTEM_PROMPT = `You are a coding agent operating in a CLI. You have access to tools for
reading, writing, and editing files, running shell commands, listing
directories, and searching file contents. Use them to accomplish the user's
task. When you are done, reply with a concise final summary of what you did.`;

// TODO(Phase 3 / skills): system prompt is currently static. Skill-matching
// and dynamic injection based on task type will extend this.

export interface RunLoopOptions {
  task: string;
  registry: ToolRegistry;
  provider: LLMProvider;
  harness: ToolExecutor;
  onEvent?: (event: LoopEvent) => void;
  maxIterations?: number;
}

export type LoopEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: any }
  | { type: "tool_result"; name: string; output?: string; error?: string };

export async function runLoop(options: RunLoopOptions): Promise<string> {
  const { task, registry, provider, harness, onEvent, maxIterations = 25 } = options;

  const messages: NormalizedMessage[] = [
    { role: "user", content: [{ type: "text", text: task }] },
  ];
  const tools = registry.toNormalizedTools();

  for (let i = 0; i < maxIterations; i++) {
    const response = await provider.complete(messages, tools, SYSTEM_PROMPT);

    const textBlocks = response.content.filter(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text"
    );
    for (const block of textBlocks) {
      if (block.text.trim()) {
        onEvent?.({ type: "assistant_text", text: block.text });
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (!response.wantsToolCall) {
      const checkpoint = await harness.checkpoint(task);
      if (checkpoint.action === "done") {
        return textBlocks.map((b) => b.text).join("\n").trim();
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: checkpoint.message ?? "" }],
      });
      continue;
    }

    const toolCalls = response.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_call" }> => b.type === "tool_call"
    );

    const toolResultBlocks: ContentBlock[] = [];
    for (const call of toolCalls) {
      onEvent?.({ type: "tool_call", name: call.name, input: call.input });

      const result = await harness.execute(call.name, call.input);

      onEvent?.({
        type: "tool_result",
        name: call.name,
        output: result.output,
        error: result.error,
      });

      toolResultBlocks.push({
        type: "tool_result",
        toolCallId: call.id,
        content: result.error ? `Error: ${result.error}` : result.output ?? "",
        isError: Boolean(result.error),
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  return "Reached max iterations without completing the task.";
}
