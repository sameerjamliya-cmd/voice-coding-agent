import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo.js";
import { runLoop, type LLMCallInterrupts } from "../src/agent/loop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Harness } from "../src/harness/harness.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { NormalizedMessage, NormalizedResponse, NormalizedTool } from "../src/llm/types.js";
import type { Tool } from "../src/agent/types.js";

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}

vi.mock("../src/shared/terminal-prompt.js", () => ({
  confirm: vi.fn(async () => true),
  choice: vi.fn(async (_q: string, options: string[]) => options[0]),
  prompt: vi.fn(async () => ""),
  closePrompt: vi.fn(),
  isVoiceModeActive: vi.fn(() => false),
}));

describe("loop.ts voice-interrupt wiring", () => {
  let repo: TempGitRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("passes beginLLMCall()'s signal into provider.complete and calls endLLMCall after a normal response", async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    const provider: LLMProvider = {
      name: "mock",
      complete: async (_m, _t, _s, signal) => {
        seenSignals.push(signal);
        return { content: [{ type: "text", text: "done" }], wantsToolCall: false, usage: usage(1, 1) };
      },
    };

    const fakeSignal = new AbortController().signal;
    const interrupts: LLMCallInterrupts = {
      beginLLMCall: vi.fn(() => fakeSignal),
      endLLMCall: vi.fn(),
    };

    const registry = new ToolRegistry();
    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });

    const result = await runLoop({ task: "test", registry, provider, harness, interrupts });

    expect(result).toBe("done");
    expect(seenSignals).toEqual([fakeSignal]);
    expect(interrupts.beginLLMCall).toHaveBeenCalledTimes(1);
    expect(interrupts.endLLMCall).toHaveBeenCalledTimes(1);
  });

  it("propagates an abort rather than proceeding with the aborted call's content", async () => {
    const provider: LLMProvider = {
      name: "mock",
      complete: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    };

    const interrupts: LLMCallInterrupts = {
      beginLLMCall: () => new AbortController().signal,
      endLLMCall: vi.fn(),
    };

    const registry = new ToolRegistry();
    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });

    await expect(runLoop({ task: "test", registry, provider, harness, interrupts })).rejects.toThrow("aborted");
    // endLLMCall still runs (via finally) even though the call threw.
    expect(interrupts.endLLMCall).toHaveBeenCalledTimes(1);
  });

  it("sets toolExecutionState.executing only while a tool call is actually running", async () => {
    const executingDuringExecute: boolean[] = [];
    const tool: Tool = {
      name: "spy_tool",
      description: "spy",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        executingDuringExecute.push(true);
        return { output: "ok" };
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    let callIndex = 0;
    const provider: LLMProvider = {
      name: "mock",
      complete: async () => {
        callIndex++;
        if (callIndex === 1) {
          return {
            content: [{ type: "tool_call", id: "1", name: "spy_tool", input: {} }],
            wantsToolCall: true,
            usage: usage(1, 1),
          };
        }
        return { content: [{ type: "text", text: "done" }], wantsToolCall: false, usage: usage(1, 1) };
      },
    };

    const toolExecutionState = { executing: false };
    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });

    expect(toolExecutionState.executing).toBe(false);
    await runLoop({ task: "test", registry, provider, harness, toolExecutionState, maxIterations: 5 });

    expect(executingDuringExecute).toEqual([true]);
    // Flag is cleared again once the tool call has resolved.
    expect(toolExecutionState.executing).toBe(false);
  });

  it("injects a pending interrupt transcript as a new user message right after a tool result is appended", async () => {
    const tool: Tool = {
      name: "spy_tool",
      description: "spy",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ output: "ok" }),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    let callIndex = 0;
    const provider: LLMProvider = {
      name: "mock",
      complete: async () => {
        callIndex++;
        if (callIndex === 1) {
          return {
            content: [{ type: "tool_call", id: "1", name: "spy_tool", input: {} }],
            wantsToolCall: true,
            usage: usage(1, 1),
          };
        }
        return { content: [{ type: "text", text: "done" }], wantsToolCall: false, usage: usage(1, 1) };
      },
    };

    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });

    let consumed = false;
    const consumePendingInterrupt = vi.fn(async () => {
      if (consumed) return undefined;
      consumed = true;
      return "voice follow-up while the tool was running";
    });

    let capturedMessages: NormalizedMessage[] = [];
    const capturingProvider: LLMProvider = {
      name: "mock-capture",
      complete: async (messages, tools: NormalizedTool[], system, signal) => {
        capturedMessages = [...messages];
        return provider.complete(messages, tools, system, signal);
      },
    };

    await runLoop({
      task: "test",
      registry,
      provider: capturingProvider,
      harness,
      consumePendingInterrupt,
      maxIterations: 5,
    });

    expect(consumePendingInterrupt).toHaveBeenCalled();
    const lastMessage = capturedMessages[capturedMessages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toEqual([
      { type: "text", text: "voice follow-up while the tool was running" },
    ]);
  });
});
