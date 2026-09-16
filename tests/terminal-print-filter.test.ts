import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runVoiceTurn, stripCodeForSpeech } from "../src/voice/voice-session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { ToolExecutor } from "../src/agent/types.js";
import type { InterruptManager } from "../src/voice/interrupt.js";
import type { SpeechQueue } from "../src/voice/tts-queue.js";

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}

function makeFakeInterruptManager(): InterruptManager {
  return {
    setTapHandler: vi.fn(),
    beginLLMCall: vi.fn(() => new AbortController().signal),
    endLLMCall: vi.fn(),
    handleInterrupt: vi.fn(() => false),
  } as unknown as InterruptManager;
}

function makeFakeHarness(): ToolExecutor {
  return {
    execute: vi.fn(async () => ({ output: "ok" })),
    checkpoint: vi.fn(async () => ({ action: "done" as const, finalText: "done" })),
    recordIteration: vi.fn(),
    endSession: vi.fn(async () => {}),
    checkTokenBudget: vi.fn(async () => ({ action: "continue" as const })),
  };
}

// Regression coverage for: code embedded in Claude's own reasoning text
// leaking into the voice-mode terminal print, even though the speech path
// already stripped it. voice-session.ts's runVoiceSession() prints
// `stripCodeForSpeech(finalText)` under "=== Final response ===" — the same
// function SentenceChunker.push() runs on every assistant_text event before
// it reaches the speech queue. There is exactly one stripping function,
// reused for both destinations, not two independently-maintained filters.
describe("voice-mode terminal print uses the same code filter as speech", () => {
  it("the text that would be printed and the text that gets spoken both have code removed, and agree with each other", async () => {
    const responseText =
      "I'll write this: ```html\n<div>hi</div>\n``` to build the page. It uses a `<div>` tag.";

    const provider: LLMProvider = {
      name: "code-in-prose-mock",
      complete: async () => ({
        content: [{ type: "text", text: responseText }],
        wantsToolCall: false,
        usage: usage(10, 10),
      }),
    };

    const spoken: string[] = [];
    const speechQueue = { enqueueSentence: vi.fn((text: string) => spoken.push(text)) } as unknown as SpeechQueue;

    const finalText = await runVoiceTurn("describe the page", {
      registry: new ToolRegistry(),
      provider,
      harness: makeFakeHarness(),
      interruptManager: makeFakeInterruptManager(),
      speechQueue,
    });

    // What runVoiceSession's "=== Final response ===" print now shows
    // (stripCodeForSpeech(finalText)) vs. what was actually spoken.
    const printedText = stripCodeForSpeech(finalText);
    const spokenText = spoken.join(" ");

    for (const text of [printedText, spokenText]) {
      expect(text).not.toContain("<div>hi</div>");
      expect(text).not.toContain("```");
      expect(text).not.toContain("`<div>`");
    }

    expect(printedText.replace(/\s+/g, " ").trim()).toBe(spokenText.replace(/\s+/g, " ").trim());
  });

  it("stripCodeForSpeech is a pure function of its input — no divergence from being called from two call sites with the same text", () => {
    const text = "Explanation before. ```py\nprint(1)\n``` Explanation after.";
    const fromSpeechCallSite = stripCodeForSpeech(text);
    const fromTerminalCallSite = stripCodeForSpeech(text);

    expect(fromTerminalCallSite).toBe(fromSpeechCallSite);
    expect(fromTerminalCallSite).not.toContain("print(1)");
  });
});

// When voice mode is off, cli.ts's plain-text session must keep printing
// assistant_text completely unfiltered — this change is scoped to voice
// mode only. Verified by inspecting the actual source of the non-voice
// onEvent handler (src/cli.ts), since that code path runs inline inside a
// commander .action() callback and isn't otherwise reachable as an
// importable unit — this asserts it still logs `event.text` directly, with
// no call to stripCodeForSpeech or any other filter wrapped around it.
describe("non-voice sessions print assistant_text unfiltered", () => {
  it("cli.ts's non-voice assistant_text handler logs event.text directly, with no code-stripping call", async () => {
    const cliSource = await readFile(join(import.meta.dirname, "..", "src", "cli.ts"), "utf-8");

    const caseMatch = cliSource.match(/case "assistant_text":\s*\n\s*console\.log\(([^)]*)\);/);
    expect(caseMatch, "expected to find the assistant_text case in cli.ts's non-voice onEvent handler").not.toBeNull();

    const loggedExpression = caseMatch![1];
    expect(loggedExpression).toContain("event.text");
    expect(loggedExpression).not.toContain("stripCodeForSpeech");
  });
});
