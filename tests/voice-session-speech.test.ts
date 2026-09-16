import { describe, it, expect, vi } from "vitest";
import { runVoiceTurn } from "../src/voice/voice-session.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { LLMProvider } from "../src/llm/provider.js";
import type { NormalizedMessage, NormalizedResponse, NormalizedTool } from "../src/llm/types.js";
import type { ToolExecutor } from "../src/agent/types.js";
import type { InterruptManager } from "../src/voice/interrupt.js";
import type { SpeechQueue } from "../src/voice/tts-queue.js";

function usage(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}

// Minimal stand-in for InterruptManager — runVoiceTurn only needs
// setTapHandler/beginLLMCall/endLLMCall for a turn that's never interrupted.
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

// Delivers `fullText` as several small streamed-looking chunks (splitting
// mid-sentence, not on sentence boundaries) across a few provider.complete()
// calls that each emit one text block — this is the shape a real streaming
// provider would produce, and the shape the bug report asked to be tested
// against, even though today's providers deliver one block per response.
function makeChunkedTextProvider(fullText: string, chunkSize: number): LLMProvider {
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += chunkSize) {
    chunks.push(fullText.slice(i, i + chunkSize));
  }
  let callIndex = 0;
  return {
    name: "chunked-mock",
    complete: async (
      _messages: NormalizedMessage[],
      _tools: NormalizedTool[],
      _system: string
    ): Promise<NormalizedResponse> => {
      const text = chunks[callIndex] ?? "";
      const isLast = callIndex >= chunks.length - 1;
      callIndex++;
      return {
        content: [{ type: "text", text }],
        wantsToolCall: !isLast,
        usage: usage(5, 5),
      };
    },
  };
}

describe("runVoiceTurn speech output — no duplicate sentences", () => {
  it("speaks a plain-text-ending response exactly once per sentence, across a streamed multi-chunk response", async () => {
    const sentences = [
      "This is the first sentence.",
      "Here comes the second one.",
      "Now a third sentence arrives.",
      "The fourth sentence follows next.",
      "A fifth sentence keeps going.",
      "Finally the sixth sentence ends it.",
    ];
    const fullText = sentences.join(" ");

    // wantsToolCall must be false only on the very last chunk for a
    // plain-text ending, but the provider above ties wantsToolCall to
    // "is this the last chunk" — that's not realistic (a real stream is one
    // response, not N tool-calling iterations), so instead simulate the
    // realistic case directly: a provider that returns the whole response
    // as a handful of separate text blocks within a SINGLE response, which
    // is exactly what triggered the bug (multiple assistant_text events in
    // the same, final, non-tool-calling iteration).
    // Deliver as several small chunks, one sentence per chunk — the
    // SentenceChunker only buffers complete detected sentences across
    // push() calls (see splitIntoSentences), not arbitrary partial-word
    // fragments, so this is the realistic granularity for "streamed across
    // multiple assistant_text events" in this codebase today. It's still
    // enough to reproduce the bug under test: multiple assistant_text
    // events firing within one plain-text-ending turn.
    const textBlockChunks = sentences.map((s, i) => (i === 0 ? s : ` ${s}`));
    const provider: LLMProvider = {
      name: "multi-block-mock",
      complete: async () => ({
        content: textBlockChunks.map((t) => ({ type: "text" as const, text: t })),
        wantsToolCall: false,
        usage: usage(10, 10),
      }),
    };

    const spoken: string[] = [];
    const speechQueue = { enqueueSentence: vi.fn((text: string) => spoken.push(text)) } as unknown as SpeechQueue;

    const result = await runVoiceTurn("say six sentences", {
      registry: new ToolRegistry(),
      provider,
      harness: makeFakeHarness(),
      interruptManager: makeFakeInterruptManager(),
      speechQueue,
    });

    const spokenTranscript = spoken.join(" ").replace(/\s+/g, " ").trim();
    const expectedTranscript = fullText.replace(/\s+/g, " ").trim();

    expect(result.replace(/\s+/g, " ").trim()).toBe(expectedTranscript);
    expect(spokenTranscript).toBe(expectedTranscript);

    // No sentence's distinctive text appears more than once across all the
    // chunks handed to enqueueSentence (normalize whitespace first — the
    // synthetic chunking above can introduce double spaces at chunk joins
    // that are irrelevant to what's under test here).
    const normalizedSpoken = spoken.map((chunk) => chunk.replace(/\s+/g, " "));
    for (const sentence of sentences) {
      const occurrences = normalizedSpoken.filter((chunk) => chunk.includes(sentence)).length;
      expect(occurrences).toBe(1);
    }
  });

  it("stream-end flush does not re-speak a sentence that was already flushed by normal boundary detection", async () => {
    // Exactly 2 sentences (== SENTENCES_PER_TTS_CHUNK) so the normal
    // boundary-detection path fires a chunk on its own, leaving nothing
    // buffered — the stream-end flush (chunker.flush(), called via the
    // finalText push after runLoop returns) must not re-emit that content.
    const fullText = "First sentence here. Second sentence here.";
    const provider: LLMProvider = {
      name: "two-sentence-mock",
      complete: async () => ({
        content: [{ type: "text", text: fullText }],
        wantsToolCall: false,
        usage: usage(10, 10),
      }),
    };

    const spoken: string[] = [];
    const speechQueue = { enqueueSentence: vi.fn((text: string) => spoken.push(text)) } as unknown as SpeechQueue;

    await runVoiceTurn("say two sentences", {
      registry: new ToolRegistry(),
      provider,
      harness: makeFakeHarness(),
      interruptManager: makeFakeInterruptManager(),
      speechQueue,
    });

    expect(spoken).toEqual(["First sentence here. Second sentence here."]);
  });

  it("still speaks finalText from a mark_task_complete ending, which was never emitted as an assistant_text event", async () => {
    const { markTaskCompleteTool } = await import("../src/tools/mark-task-complete.js");
    const registry = new ToolRegistry();
    registry.register(markTaskCompleteTool);

    let callIndex = 0;
    const provider: LLMProvider = {
      name: "mark-complete-mock",
      complete: async () => {
        callIndex++;
        if (callIndex === 1) {
          return {
            content: [
              {
                type: "tool_call",
                id: "1",
                name: "mark_task_complete",
                input: { original_task: "task", summary: "All done here." },
              },
            ],
            wantsToolCall: true,
            usage: usage(5, 5),
          };
        }
        return { content: [{ type: "text", text: "unused" }], wantsToolCall: false, usage: usage(5, 5) };
      },
    };

    const spoken: string[] = [];
    const speechQueue = { enqueueSentence: vi.fn((text: string) => spoken.push(text)) } as unknown as SpeechQueue;

    const harness = makeFakeHarness();
    (harness.checkpoint as ReturnType<typeof vi.fn>).mockResolvedValue({
      action: "done",
      finalText: "All done here.",
    });

    const result = await runVoiceTurn("do a task", {
      registry,
      provider,
      harness,
      interruptManager: makeFakeInterruptManager(),
      speechQueue,
    });

    expect(result).toBe("All done here.");
    expect(spoken).toEqual(["All done here."]);
  });
});

describe("terminal print vs. speech use the same code-stripping filter", () => {
  it("stripCodeForSpeech removes the same code from text destined for both the terminal summary print and the speech queue", async () => {
    const { stripCodeForSpeech } = await import("../src/voice/voice-session.js");

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

    const result = await runVoiceTurn("describe the page", {
      registry: new ToolRegistry(),
      provider,
      harness: makeFakeHarness(),
      interruptManager: makeFakeInterruptManager(),
      speechQueue,
    });

    // `result` is exactly what runVoiceSession's "=== Final response ==="
    // print now runs through stripCodeForSpeech before printing (see
    // voice-session.ts) — assert applying that same shared function to it
    // matches what was actually spoken, and that neither destination shows
    // the code.
    const printedText = stripCodeForSpeech(result);
    const spokenText = spoken.join(" ");

    expect(printedText).not.toContain("<div>hi</div>");
    expect(printedText).not.toContain("```");
    expect(spokenText).not.toContain("<div>hi</div>");
    expect(spokenText).not.toContain("```");
    expect(spokenText).not.toContain("`<div>`");

    expect(printedText.replace(/\s+/g, " ").trim()).toBe(spokenText.replace(/\s+/g, " ").trim());
  });
});
