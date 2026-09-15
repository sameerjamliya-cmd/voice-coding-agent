import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Deferred per-call so a test can control exactly when each sentence's
// "synthesis" resolves, independent of enqueue order — that's the whole
// point of the ordering guarantee under test.
let pendingSpeechCalls: Array<{ text: string; resolve: () => void; signal: AbortSignal }> = [];

vi.mock("openai", () => {
  class MockOpenAI {
    audio = {
      speech: {
        create: vi.fn((params: { input: string }, opts: { signal: AbortSignal }) => {
          return new Promise((resolve, reject) => {
            const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            if (opts.signal.aborted) return onAbort();
            opts.signal.addEventListener("abort", onAbort, { once: true });
            pendingSpeechCalls.push({
              text: params.input,
              signal: opts.signal,
              resolve: () => {
                opts.signal.removeEventListener("abort", onAbort);
                resolve({ arrayBuffer: async () => new ArrayBuffer(4) });
              },
            });
          });
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(async () => {}), unlink: vi.fn(async () => {}) };
});

const spawnedPlayers: Array<{ proc: EventEmitter & { kill: ReturnType<typeof vi.fn> }; file: string }> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_bin: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), { kill: vi.fn() });
    spawnedPlayers.push({ proc, file: args[args.length - 1] });
    return proc;
  }),
}));

// Imported after the mocks above so tts-queue.ts picks up the mocked
// modules rather than the real openai SDK / child_process.
const { SpeechQueue } = await import("../src/voice/tts-queue.js");

function resolveSpeechFor(text: string): void {
  const call = pendingSpeechCalls.find((c) => c.text === text);
  if (!call) throw new Error(`No pending TTS call for "${text}"`);
  call.resolve();
  pendingSpeechCalls = pendingSpeechCalls.filter((c) => c !== call);
}

describe("SpeechQueue", () => {
  beforeEach(() => {
    pendingSpeechCalls = [];
    spawnedPlayers.length = 0;
  });

  it("plays sentences in index order even when a later sentence's TTS resolves first", async () => {
    const queue = new SpeechQueue("fake-key");
    const playedOrder: number[] = [];

    queue.enqueueSentence("first");
    queue.enqueueSentence("second");
    queue.enqueueSentence("third");

    // Resolve out of order: third's synthesis finishes before first's.
    resolveSpeechFor("third");
    resolveSpeechFor("first");
    resolveSpeechFor("second");

    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(1));
    expect(spawnedPlayers[0].file).toContain(".mp3");
    playedOrder.push(0);
    spawnedPlayers[0].proc.emit("exit", 0);

    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(2));
    playedOrder.push(1);
    spawnedPlayers[1].proc.emit("exit", 0);

    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(3));
    playedOrder.push(2);
    spawnedPlayers[2].proc.emit("exit", 0);

    await vi.waitFor(() => expect(pendingSpeechCalls.length).toBe(0));
    expect(playedOrder).toEqual([0, 1, 2]);
    expect(spawnedPlayers.length).toBe(3);
  });

  it("never plays more than one slot at a time", async () => {
    const queue = new SpeechQueue("fake-key");
    queue.enqueueSentence("first");
    queue.enqueueSentence("second");

    resolveSpeechFor("first");
    resolveSpeechFor("second");

    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(1));
    // Give the (mocked) synthesis + scheduling microtasks a chance to run;
    // if the worker were not sequential, a second player would spawn here
    // even though the first hasn't exited yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(spawnedPlayers.length).toBe(1);

    spawnedPlayers[0].proc.emit("exit", 0);
    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(2));
  });

  it("drainAndStop kills active playback and prevents queued sentences from playing later", async () => {
    const queue = new SpeechQueue("fake-key");
    queue.enqueueSentence("first");
    queue.enqueueSentence("second");
    queue.enqueueSentence("third");

    resolveSpeechFor("first");
    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(1));

    queue.drainAndStop();
    expect(spawnedPlayers[0].proc.kill).toHaveBeenCalled();

    // Resolve the still-in-flight TTS for the remaining sentences after the
    // drain — they must never reach playback.
    resolveSpeechFor("second");
    resolveSpeechFor("third");

    // Simulate the killed player's exit event finally arriving.
    spawnedPlayers[0].proc.emit("exit", null);

    await new Promise((r) => setTimeout(r, 20));
    expect(spawnedPlayers.length).toBe(1); // no new playback started
  });

  it("drainAndStop is safe to call when the queue is empty", () => {
    const queue = new SpeechQueue("fake-key");
    expect(() => queue.drainAndStop()).not.toThrow();
  });

  it("aborts pending TTS requests for sentences that never became ready", async () => {
    const queue = new SpeechQueue("fake-key");
    queue.enqueueSentence("first");
    queue.enqueueSentence("second");

    resolveSpeechFor("first");
    await vi.waitFor(() => expect(spawnedPlayers.length).toBe(1));

    const secondCall = pendingSpeechCalls.find((c) => c.text === "second");
    expect(secondCall).toBeDefined();

    queue.drainAndStop();
    expect(secondCall!.signal.aborted).toBe(true);
  });
});
