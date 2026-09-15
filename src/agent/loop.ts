import type { LLMProvider } from "../llm/provider.js";
import type { ContentBlock, NormalizedMessage, NormalizedResponse } from "../llm/types.js";
import type { ToolExecutor } from "./types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Skill } from "../skills/types.js";
import { composeSystemPrompt } from "../skills/compose-system-prompt.js";

const MARK_TASK_COMPLETE = "mark_task_complete";

const BASE_SYSTEM_PROMPT = `You are a coding agent operating in a CLI. You have access to tools for
reading, writing, and editing files, running shell commands, listing
directories, and searching file contents. Use them to accomplish the user's
task.

Before taking your first action on any task, orient yourself in the current
working directory — list its contents and check for an obvious entry point
(e.g. a package manifest such as package.json, requirements.txt, Cargo.toml,
or a README) — unless you already have sufficient context about this
directory from earlier in the current session. Do not run commands or make
assumptions about the project's structure, build system, or tooling before
confirming what's actually present.

When you believe the task is fully complete, call ${MARK_TASK_COMPLETE} —
restate the original task and explain how your changes satisfy it. This is
the only thing that triggers validation (the project's test suite). If you
stop without calling it (a plain-text reply, or you get stuck), the loop
just ends with no validation — so call it whenever you're claiming the task
is actually done.

Only one tool call is processed per turn, even if you propose several —
propose exactly one action at a time and use its real result to decide
what to do next.

Loaded skills provide guidance, not absolute rules, and the task's own
explicit instructions always take precedence over any skill's general
guidance. If two loaded skills genuinely conflict in a way that changes
the concrete next action, and the conflict is consequential (not just a
stylistic preference), use ask_user to surface the tradeoff rather than
silently picking one. As a soft default when a quick judgment call is
needed: guidance related to correctness or safety (e.g. debugging,
secure-coding, test-driven-fixing) takes precedence over guidance
related to efficiency or style (e.g. performance-awareness,
incremental-changes) when they genuinely conflict.`;

// Satisfied by voice/interrupt.ts's InterruptManager, but loop.ts stays
// decoupled from the voice/ layer — it only needs this much of the shape.
export interface LLMCallInterrupts {
  beginLLMCall(): AbortSignal;
  endLLMCall(): void;
}

export interface RunLoopOptions {
  task: string;
  registry: ToolRegistry;
  provider: LLMProvider;
  harness: ToolExecutor;
  skills?: Skill[];
  onEvent?: (event: LoopEvent) => void;
  maxIterations?: number;
  // Voice-mode only. When set, wraps every provider.complete() call with an
  // abortable signal so a tap-to-interrupt during an in-flight LLM call can
  // cancel it outright (see voice/interrupt.ts).
  interrupts?: LLMCallInterrupts;
  // Voice-mode only. Updated around the tool-execution call so
  // InterruptManager.handleInterrupt() can tell whether a tap landed while a
  // tool was actively running (in which case the tap must not cancel it).
  toolExecutionState?: { executing: boolean };
  // Voice-mode only. Checked right after a tool result is appended to the
  // conversation — the one safe point to inject a transcript that arrived
  // via a tap during that tool's execution. Async because a queued tap
  // means recording + transcribing is still in flight at that point; the
  // loop awaits it here rather than racing ahead. Returns and clears it.
  consumePendingInterrupt?: () => Promise<string | undefined>;
}

export type LoopEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: any }
  | { type: "tool_result"; name: string; output?: string; error?: string };

export async function runLoop(options: RunLoopOptions): Promise<string> {
  const {
    task,
    registry,
    provider,
    harness,
    skills = [],
    onEvent,
    maxIterations = 25,
    interrupts,
    toolExecutionState,
    consumePendingInterrupt,
  } = options;

  const messages: NormalizedMessage[] = [
    { role: "user", content: [{ type: "text", text: task }] },
  ];
  const tools = registry.toNormalizedTools();
  const systemPrompt = composeSystemPrompt(BASE_SYSTEM_PROMPT, skills);

  for (let i = 0; i < maxIterations; i++) {
    harness.recordIteration?.();
    const signal = interrupts?.beginLLMCall();
    let response: NormalizedResponse;
    try {
      response = await provider.complete(messages, tools, systemPrompt, signal);
    } finally {
      interrupts?.endLLMCall();
    }

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
      await injectPendingInterrupt(messages, consumePendingInterrupt);
      continue;
    }

    if (call) {
      onEvent?.({ type: "tool_call", name: call.name, input: call.input });

      if (toolExecutionState) toolExecutionState.executing = true;
      let result;
      try {
        result = await harness.execute(call.name, call.input);
      } finally {
        if (toolExecutionState) toolExecutionState.executing = false;
      }

      onEvent?.({
        type: "tool_result",
        name: call.name,
        output: result.output,
        error: result.error,
      });

      if (result.stop) {
        await harness.endSession?.("abandoned");
        return result.error ?? "Stopped after repeated identical tool-call failures.";
      }

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
    await injectPendingInterrupt(messages, consumePendingInterrupt);
  }

  await harness.endSession?.("max_iterations");
  return "Reached max iterations without completing the task.";
}

// The one safe injection point during tool execution: right after that
// tool's result is appended, before the loop calls provider.complete()
// again. Never injected mid-tool-call.
async function injectPendingInterrupt(
  messages: NormalizedMessage[],
  consumePendingInterrupt?: () => Promise<string | undefined>
): Promise<void> {
  const pending = await consumePendingInterrupt?.();
  if (pending) {
    messages.push({ role: "user", content: [{ type: "text", text: pending }] });
  }
}
