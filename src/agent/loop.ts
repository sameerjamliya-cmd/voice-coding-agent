import type { LLMProvider } from "../llm/provider.js";
import type { ContentBlock, NormalizedMessage } from "../llm/types.js";
import type { ToolExecutor } from "./types.js";
import type { ToolRegistry } from "../tools/registry.js";

const MARK_TASK_COMPLETE = "mark_task_complete";

const SYSTEM_PROMPT = `You are a coding agent operating in a CLI. You have access to tools for
reading, writing, and editing files, running shell commands, listing
directories, and searching file contents. Use them to accomplish the user's
task.

When you believe the task is fully complete, call ${MARK_TASK_COMPLETE} —
restate the original task and explain how your changes satisfy it. This is
the only thing that triggers validation (the project's test suite). If you
stop without calling it (a plain-text reply, or you get stuck), the loop
just ends with no validation — so call it whenever you're claiming the task
is actually done.

Only one tool call is processed per turn, even if you propose several —
propose exactly one action at a time and use its real result to decide
what to do next.`;

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
    harness.recordIteration?.();
    const response = await provider.complete(messages, tools, SYSTEM_PROMPT);

    const budget = await harness.checkTokenBudget?.(response.usage);
    if (budget?.action === "stop") {
      await harness.endSession?.("abandoned");
      return budget.message ?? "Stopped: token budget exceeded.";
    }

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
      // A plain-text ending with no mark_task_complete call is just the
      // loop stopping — not a completion claim, so nothing to validate.
      await harness.endSession?.("completed");
      return textBlocks.map((b) => b.text).join("\n").trim();
    }

    const toolCalls = response.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_call" }> => b.type === "tool_call"
    );

    // Only the first proposed call is ever executed, even if the model
    // returned several tool_use blocks — see harness.ts and the provider
    // calls above for the best-effort API-level hints toward the same
    // behavior. Every proposed call still needs a tool_result, though
    // (the API requires one per tool_use in the preceding turn), so the
    // dropped calls get an explicit "not processed" result rather than
    // being silently ignored.
    const toolResultBlocks: ContentBlock[] = [];
    const [call, ...dropped] = toolCalls;

    if (call && call.name === MARK_TASK_COMPLETE) {
      const originalTask: string = call.input?.original_task ?? task;
      const summary: string = call.input?.summary ?? "";

      onEvent?.({ type: "tool_call", name: call.name, input: call.input });

      const checkpoint = await harness.checkpoint(originalTask, summary);

      onEvent?.({
        type: "tool_result",
        name: call.name,
        output: checkpoint.action === "done" ? (checkpoint.finalText ?? summary) : undefined,
        error: checkpoint.action === "continue" ? checkpoint.message : undefined,
      });

      if (checkpoint.action === "done") {
        await harness.endSession?.("completed");
        return checkpoint.finalText ?? summary;
      }

      toolResultBlocks.push({
        type: "tool_result",
        toolCallId: call.id,
        content: checkpoint.message ?? "",
        isError: true,
      });

      for (const skipped of dropped) {
        toolResultBlocks.push({
          type: "tool_result",
          toolCallId: skipped.id,
          content: `Not processed — only one tool call is executed per turn, and ${call.name} was executed first. Propose this again in your next turn if it's still needed.`,
          isError: false,
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });
      continue;
    }

    if (call) {
      onEvent?.({ type: "tool_call", name: call.name, input: call.input });

      const result = await harness.execute(call.name, call.input);

      onEvent?.({
        type: "tool_result",
        name: call.name,
        output: result.output,
        error: result.error,
      });

      let content = result.error ? `Error: ${result.error}` : result.output ?? "";
      if (dropped.length > 0) {
        const droppedNames = dropped.map((d) => d.name).join(", ");
        content +=
          `\n\n[harness] Only one tool call is processed per turn. You proposed ${toolCalls.length} calls — ` +
          `only the first (${call.name}) was executed. Not run: ${droppedNames}. ` +
          `If they are still needed, propose them again based on this result.`;
      }

      toolResultBlocks.push({
        type: "tool_result",
        toolCallId: call.id,
        content,
        isError: Boolean(result.error),
      });

      for (const skipped of dropped) {
        toolResultBlocks.push({
          type: "tool_result",
          toolCallId: skipped.id,
          content: `Not processed — only one tool call is executed per turn, and ${call.name} was executed first. Propose this again in your next turn if it's still needed.`,
          isError: false,
        });
      }
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  await harness.endSession?.("max_iterations");
  return "Reached max iterations without completing the task.";
}
