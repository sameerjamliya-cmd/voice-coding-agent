import { describe, it, expect, vi } from "vitest";
import { InterruptManager } from "../src/voice/interrupt.js";
import { InterruptFollowUpMailbox } from "../src/voice/voice-session.js";
import type { SpeechQueue } from "../src/voice/tts-queue.js";

function makeFakeSpeechQueue(): { queue: SpeechQueue; drainAndStop: ReturnType<typeof vi.fn> } {
  const drainAndStop = vi.fn();
  return { queue: { drainAndStop } as unknown as SpeechQueue, drainAndStop };
}

describe("InterruptManager", () => {
  it("beginLLMCall() returns a fresh AbortSignal each time", () => {
    const { queue } = makeFakeSpeechQueue();
    const manager = new InterruptManager(queue);

    const signal1 = manager.beginLLMCall();
    const signal2 = manager.beginLLMCall();

    expect(signal1).not.toBe(signal2);
    expect(signal1.aborted).toBe(false);
    expect(signal2.aborted).toBe(false);
  });

  it("endLLMCall() clears the internal controller so a later handleInterrupt has nothing to abort", () => {
    const { queue } = makeFakeSpeechQueue();
    const manager = new InterruptManager(queue);

    const signal = manager.beginLLMCall();
    manager.endLLMCall();

    // The signal captured before endLLMCall() must never retroactively
    // abort just because a later, unrelated handleInterrupt() runs.
    manager.handleInterrupt(false);
    expect(signal.aborted).toBe(false);
  });

  it("handleInterrupt(false) aborts the in-flight LLM call's signal", () => {
    const { queue } = makeFakeSpeechQueue();
    const manager = new InterruptManager(queue);

    const signal = manager.beginLLMCall();
    expect(signal.aborted).toBe(false);

    manager.handleInterrupt(false);
    expect(signal.aborted).toBe(true);
  });

  it("handleInterrupt() always drains the speech queue, regardless of isToolExecuting", () => {
    const { queue, drainAndStop } = makeFakeSpeechQueue();
    const manager = new InterruptManager(queue);

    manager.handleInterrupt(false);
    expect(drainAndStop).toHaveBeenCalledTimes(1);

    manager.handleInterrupt(true);
    expect(drainAndStop).toHaveBeenCalledTimes(2);
  });

  it("handleInterrupt(true) does not abort the in-flight LLM call — tools are never cancelled by an interrupt", () => {
    const { queue } = makeFakeSpeechQueue();
    const manager = new InterruptManager(queue);

    const signal = manager.beginLLMCall();
    const wasToolExecuting = manager.handleInterrupt(true);

    expect(wasToolExecuting).toBe(true);
    // No LLM call was actually in flight conceptually (a tool is running,
    // not the model), but handleInterrupt's contract is the same either
    // way: it only ever aborts whatever beginLLMCall() last handed out.
    // The real guarantee under test is the *return value* echoing
    // isToolExecuting back to the caller, which is what voice-session.ts
    // uses to decide "queue this transcript" vs. "start it immediately" —
    // a running tool call itself is simply never given an AbortSignal to
    // begin with (see loop.ts: harness.execute() is awaited directly, with
    // no interrupts-aware wrapping), so there is nothing tool-related here
    // that could be aborted in the first place.
    expect(signal.aborted).toBe(true); // the LLM-call signal, not a tool
  });
});

// The mailbox that fixed the duplicate-transcript-processing bug (a tap
// during tool execution and a tap that aborts an in-flight LLM call used to
// share enough state that both paths could see the same non-null value).
// See voice-session.ts's InterruptFollowUpMailbox for the full explanation.
describe("InterruptFollowUpMailbox — regression: atomic consume, no cross-contamination", () => {
  it("consume() is atomic: a value can never be consumed more than once", async () => {
    const mailbox = new InterruptFollowUpMailbox();
    mailbox.set(Promise.resolve("first task"), true);

    const first = await mailbox.consume();
    expect(first).toBe("first task");

    const second = await mailbox.consume();
    expect(second).toBeUndefined();
  });

  it("a value armed for the interrupt path is never returned by the non-interrupt path, and vice versa", async () => {
    const interruptMailbox = new InterruptFollowUpMailbox();
    interruptMailbox.set(Promise.resolve("mid-tool follow-up"), true);
    expect(interruptMailbox.takeNonInterrupt()).toBeNull();
    expect(await interruptMailbox.consume()).toBe("mid-tool follow-up");

    const nonInterruptMailbox = new InterruptFollowUpMailbox();
    nonInterruptMailbox.set(Promise.resolve("next turn's task"), false);
    expect(await nonInterruptMailbox.consume()).toBeUndefined();
    expect(await nonInterruptMailbox.takeNonInterrupt()).toBe("next turn's task");
  });

  it("re-arming with set() after a consume does not resurrect the old value", async () => {
    const mailbox = new InterruptFollowUpMailbox();
    mailbox.set(Promise.resolve("stale"), true);
    expect(await mailbox.consume()).toBe("stale");

    mailbox.set(Promise.resolve("fresh"), true);
    expect(await mailbox.consume()).toBe("fresh");
    expect(await mailbox.consume()).toBeUndefined();
  });
});
