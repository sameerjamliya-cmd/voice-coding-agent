import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo.js";
import { runLoop } from "../src/agent/loop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Harness } from "../src/harness/harness.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { NormalizedMessage, NormalizedResponse, NormalizedTool } from "../src/llm/types.js";
import type { Tool } from "../src/agent/types.js";

// A fully deterministic, scripted LLMProvider — no live API calls, no
// cost, no non-determinism. `next` is called once per loop iteration
// with the 0-based call index, so a test can script a fixed sequence or
// an infinite repeating one (for the max-iteration test).
class MockProvider implements LLMProvider {
  name = "mock";
  callCount = 0;
  messagesPerCall: NormalizedMessage[][] = [];

  constructor(private next: (callIndex: number) => NormalizedResponse) {}

  async complete(messages: NormalizedMessage[], _tools: NormalizedTool[], _system: string): Promise<NormalizedResponse> {
    // loop.ts mutates `messages` in place via push() rather than
    // reassigning it, so capturing the bare reference here would mean
    // every entry in messagesPerCall ends up pointing at the same final
    // array — snapshot it with a shallow copy instead.
    this.messagesPerCall.push([...messages]);
    const response = this.next(this.callCount);
    this.callCount++;
    return response;
  }
}

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}

function makeSpyTool(name: string): { tool: Tool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({ output: `ran ${name}` }));
  return { tool: { name, description: `test tool ${name}`, inputSchema: { type: "object", properties: {} }, execute }, execute };
}

// Mocked so checkTokenBudget's/checkpoint's ask_user-style prompts never
// touch real stdin — this file drives them with scripted responses
// instead of a human.
vi.mock("../src/shared/terminal-prompt.js", () => ({
  confirm: vi.fn(async () => true),
  choice: vi.fn(async (_q: string, options: string[]) => options[0]),
  prompt: vi.fn(async () => ""),
  closePrompt: vi.fn(),
}));

describe("loop + harness integration (via MockProvider)", () => {
  let repo: TempGitRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("only executes the first of several proposed tool calls, and tells the model which one", async () => {
    const { tool: toolA, execute: execA } = makeSpyTool("toolA");
    const { tool: toolB, execute: execB } = makeSpyTool("toolB");
    const { tool: toolC, execute: execC } = makeSpyTool("toolC");
    const registry = new ToolRegistry();
    registry.register(toolA);
    registry.register(toolB);
    registry.register(toolC);

    const provider = new MockProvider((callIndex) => {
      if (callIndex === 0) {
        return {
          content: [
            { type: "tool_call", id: "1", name: "toolA", input: {} },
            { type: "tool_call", id: "2", name: "toolB", input: {} },
            { type: "tool_call", id: "3", name: "toolC", input: {} },
          ],
          wantsToolCall: true,
          usage: usage(10, 10),
        };
      }
      return { content: [{ type: "text", text: "done" }], wantsToolCall: false, usage: usage(10, 10) };
    });

    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });
    const result = await runLoop({ task: "test", registry, provider, harness, maxIterations: 5 });

    expect(result).toBe("done");
    expect(execA).toHaveBeenCalledTimes(1);
    expect(execB).not.toHaveBeenCalled();
    expect(execC).not.toHaveBeenCalled();

    // The second provider.complete() call received the tool results —
    // confirm the message fed back explicitly names what was skipped.
    const secondCallMessages = provider.messagesPerCall[1];
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1];
    const contents = toolResultMessage.content
      .filter((b): b is Extract<typeof b, { type: "tool_result" }> => b.type === "tool_result")
      .map((b) => b.content);

    expect(contents.some((c) => c.includes("Only one tool call is processed per turn"))).toBe(true);
    expect(contents.some((c) => c.includes("toolB") || c.includes("toolC"))).toBe(true);
    expect(contents.filter((c) => c.includes("Not processed"))).toHaveLength(2);
  });

  it("a plain-text ending with no mark_task_complete call does not trigger validation", async () => {
    const registry = new ToolRegistry();
    const provider = new MockProvider(() => ({
      content: [{ type: "text", text: "Just answering directly, no tools needed." }],
      wantsToolCall: false,
      usage: usage(5, 5),
    }));

    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });
    const checkpointSpy = vi.spyOn(harness, "checkpoint");

    const result = await runLoop({ task: "test", registry, provider, harness, maxIterations: 5 });

    expect(result).toBe("Just answering directly, no tools needed.");
    expect(checkpointSpy).not.toHaveBeenCalled();
  });

  it("a mark_task_complete call runs validation and captures original_task and summary", async () => {
    // A real test script so run_tests actually executes, rather than
    // hitting the "no test script configured" skip path.
    await writeFile(join(repo.cwd, "package.json"), JSON.stringify({ name: "t", scripts: { test: "node test.js" } }), "utf-8");
    await writeFile(join(repo.cwd, "test.js"), `console.log("PASS");\nprocess.exit(0);\n`, "utf-8");
    await import("node:child_process").then(({ execFileSync }) =>
      execFileSync("git", ["add", "-A"], { cwd: repo.cwd })
    );
    await import("node:child_process").then(({ execFileSync }) =>
      execFileSync("git", ["commit", "-q", "-m", "add test harness"], { cwd: repo.cwd })
    );

    const { runTestsTool } = await import("../src/tools/run-tests.js");
    const { writeFileTool } = await import("../src/tools/write-file.js");
    const { markTaskCompleteTool } = await import("../src/tools/mark-task-complete.js");
    const registry = new ToolRegistry();
    registry.register(runTestsTool);
    registry.register(writeFileTool);
    registry.register(markTaskCompleteTool);

    const provider = new MockProvider((callIndex) => {
      if (callIndex === 0) {
        return {
          // write_file takes `path` as given — it isn't scoped through
          // harness's cwd (that's only used for git/config), so this must
          // be an absolute path into the temp repo, not a bare relative
          // one, or it would write into the real process cwd instead.
          content: [
            {
              type: "tool_call",
              id: "1",
              name: "write_file",
              input: { path: join(repo.cwd, "a.txt"), content: "hi" },
            },
          ],
          wantsToolCall: true,
          usage: usage(10, 10),
        };
      }
      return {
        content: [
          {
            type: "tool_call",
            id: "2",
            name: "mark_task_complete",
            input: { original_task: "write a file", summary: "created a.txt with the content hi" },
          },
        ],
        wantsToolCall: true,
        usage: usage(10, 10),
      };
    });

    const harness = await Harness.create(registry, { task: "write a file", cwd: repo.cwd });
    const checkpointSpy = vi.spyOn(harness, "checkpoint");

    const result = await runLoop({ task: "write a file", registry, provider, harness, maxIterations: 5 });

    expect(checkpointSpy).toHaveBeenCalledWith("write a file", "created a.txt with the content hi");
    expect(result).toBe("created a.txt with the content hi");
  });

  it("token budget: crossing the soft threshold prompts, exceeding the hard ceiling stops even without a response", async () => {
    const { choice } = await import("../src/shared/terminal-prompt.js");
    (choice as ReturnType<typeof vi.fn>).mockClear();
    (choice as ReturnType<typeof vi.fn>).mockImplementation(async (_q: string, options: string[]) => options[0]); // "Continue"

    const { tool: toolA } = makeSpyTool("toolA");
    const registry = new ToolRegistry();
    registry.register(toolA);

    // budget=100, hardCeilingMultiplier default 2 -> hardCeiling=200.
    // Call 1: cumulative 70 (< 100) -> silent continue.
    // Call 2: cumulative 120 (>= 100, < 200) -> first crossing -> prompts choice(), scripted "Continue".
    // Call 3: cumulative 220 (>= 200) -> hard ceiling -> stops WITHOUT prompting again.
    const usages = [usage(60, 10), usage(40, 10), usage(90, 10)];
    const provider = new MockProvider((callIndex) => ({
      content: [{ type: "tool_call", id: String(callIndex), name: "toolA", input: {} }],
      wantsToolCall: true,
      usage: usages[callIndex] ?? usage(0, 0),
    }));

    const harness = await Harness.create(registry, {
      task: "test",
      cwd: repo.cwd,
      configOverrides: { tokenBudget: 100, hardCeilingMultiplier: 2 },
    });

    const result = await runLoop({ task: "test", registry, provider, harness, maxIterations: 10 });

    expect(result).toMatch(/hard ceiling/i);
    expect(provider.callCount).toBe(3); // never reached a 4th call
    expect(choice).toHaveBeenCalledTimes(1); // only the soft-threshold crossing prompted
    expect((choice as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/120 \/ 100 tokens/);
  });

  it("halts at the configured max-iteration cap when the model never stops requesting tools", async () => {
    const { tool: toolA } = makeSpyTool("toolA");
    const registry = new ToolRegistry();
    registry.register(toolA);

    const provider = new MockProvider((callIndex) => ({
      content: [{ type: "tool_call", id: String(callIndex), name: "toolA", input: {} }],
      wantsToolCall: true,
      usage: usage(1, 1),
    }));

    const harness = await Harness.create(registry, { task: "test", cwd: repo.cwd });
    const result = await runLoop({ task: "test", registry, provider, harness, maxIterations: 3 });

    expect(result).toBe("Reached max iterations without completing the task.");
    expect(provider.callCount).toBe(3);
  });
});
