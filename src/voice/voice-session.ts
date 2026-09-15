import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runLoop, type LoopEvent } from "../agent/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ToolExecutor } from "../agent/types.js";
import type { Skill } from "../skills/types.js";
import { InterruptManager } from "./interrupt.js";
import { SpeechQueue } from "./tts-queue.js";
import { startRecording } from "./audio-capture.js";
import { transcribe } from "./stt.js";

// Called at startup before voice mode is entered — fails with a clear
// message instead of letting a bare SDK error surface later from deep
// inside stt.ts/tts-queue.ts.
export function assertVoiceEnvReady(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "Voice mode requires OPENAI_API_KEY (used for Whisper transcription and text-to-speech) — " +
        "add it to your .env file. ANTHROPIC_API_KEY is unaffected and still used for the agent itself."
    );
  }
}

// Sentence boundary: '.', '?' or '!' followed by whitespace or end of
// string. Buffers nothing across calls — each assistant_text block from the
// loop is chunked independently and enqueued sentence-by-sentence.
function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

export interface VoiceSessionDeps {
  registry: ToolRegistry;
  provider: LLMProvider;
  harness: ToolExecutor;
  skills?: Skill[];
  interruptManager: InterruptManager;
  speechQueue: SpeechQueue;
}

export interface VoiceSessionSharedDeps {
  registry: ToolRegistry;
  provider: LLMProvider;
  skills?: Skill[];
  interruptManager: InterruptManager;
  speechQueue: SpeechQueue;
  // A Harness is one-per-task (it owns and closes its own history DB, git
  // snapshot lifecycle, etc. — see harness.ts's endSession()), so each turn
  // in the voice REPL needs its own, built fresh with that turn's task text
  // — mirroring exactly how a single `agent run "<task>"` invocation works.
  createHarness: (task: string) => Promise<ToolExecutor>;
}

// Thrown out of runVoiceTurn when a tap interrupted an in-flight LLM call
// (not a tool call — those are never aborted). Carries the follow-up
// recording that was already kicked off by the tap, so the session loop can
// use it as the next turn's task instead of throwing the input away.
class TurnInterrupted extends Error {
  constructor(public readonly followUpTask: Promise<string | undefined>) {
    super("Turn interrupted by tap");
  }
}

async function captureFollowUp(): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const { filePath } = await startRecording(controller.signal);
    const text = await transcribe(filePath);
    if (!text.trim()) {
      console.log("[voice] heard nothing intelligible (empty transcript) — tap again and try speaking louder/closer to the mic.");
      return undefined;
    }
    console.log(`[voice] heard: "${text}"`);
    return text;
  } catch (err: any) {
    console.log(`[voice] ${err.message}`);
    return undefined;
  }
}

// One full cycle: feed `task` into the existing loop exactly as typed input
// would be (no special-casing for voice-originated tasks in the loop
// itself), speaking streamed reasoning text and approval prompts as they
// arrive, and handling a tap-to-interrupt at any point during the turn.
export async function runVoiceTurn(task: string, deps: VoiceSessionDeps): Promise<string> {
  const { registry, provider, harness, skills, interruptManager, speechQueue } = deps;

  const toolExecutionState = { executing: false };
  let awaitingFollowUpRecording = false;
  let followUpCapture: Promise<string | undefined> | null = null;

  interruptManager.setTapHandler(() => {
    const wasToolExecuting = interruptManager.handleInterrupt(toolExecutionState.executing);
    followUpCapture = captureFollowUp();
    awaitingFollowUpRecording = wasToolExecuting;
  });

  try {
    const finalText = await runLoop({
      task,
      registry,
      provider,
      harness,
      skills,
      interrupts: interruptManager,
      toolExecutionState,
      // The one safe injection point during tool execution: the loop calls
      // this right after a tool's result is appended, which is also
      // exactly when a queued (tool-executing-at-tap-time) recording should
      // resolve. A tap that landed with no tool running never sets
      // awaitingFollowUpRecording, so this is a no-op then.
      consumePendingInterrupt: async () => {
        if (!awaitingFollowUpRecording || !followUpCapture) return undefined;
        const text = await followUpCapture;
        awaitingFollowUpRecording = false;
        followUpCapture = null;
        return text;
      },
      onEvent: (event: LoopEvent) => {
        if (event.type === "assistant_text") {
          for (const sentence of splitIntoSentences(event.text)) {
            speechQueue.enqueueSentence(sentence);
          }
        }
        // tool_call / tool_result: terminal-only, never spoken — these can
        // carry file contents, diffs, command output, or search results.
      },
    });

    if (finalText.trim()) {
      for (const sentence of splitIntoSentences(finalText)) {
        speechQueue.enqueueSentence(sentence);
      }
    }

    return finalText;
  } catch (err: any) {
    // An in-flight LLM call was aborted by a tap (isToolExecuting was
    // false, so handleInterrupt cancelled it immediately) — the follow-up
    // recording that tap kicked off becomes the next turn's task.
    if (followUpCapture && !awaitingFollowUpRecording) {
      throw new TurnInterrupted(followUpCapture);
    }
    throw err;
  } finally {
    interruptManager.setTapHandler(null);
  }
}

export interface RunVoiceSessionOptions extends VoiceSessionSharedDeps {
  initialTask?: string;
}

// Top-level REPL for voice mode: idle -> (tap or typed line) -> run a turn
// -> back to idle. Typed input keeps working at any point (hybrid, not
// voice-exclusive) — whichever of a completed voice recording or a typed
// line arrives first is what starts the next turn.
export async function runVoiceSession(options: RunVoiceSessionOptions): Promise<void> {
  const { interruptManager, initialTask, createHarness, ...deps } = options;
  const rl = createInterface({ input: stdin, output: stdout });

  // Must happen after the readline Interface above, not before: Node's
  // keypress decoder (readline.emitKeypressEvents) is bound to whichever
  // caller reaches it first, and the Interface needs to be that caller so
  // it can echo typed characters and fire 'line' on Enter. Calling it here
  // (a second, later call) is then a harmless no-op for the decoder itself
  // while still attaching InterruptManager's own listener for the
  // activation key.
  interruptManager.startKeyListener();
  // readline inserts Tab as a literal character into its line buffer when
  // no completer is registered (its own keypress handler runs before
  // InterruptManager's, so this is already true by the time the guard
  // below checks it). That means a genuine "first tap on an empty line"
  // looks like `rl.line === "\t"` (length 1), not "" — so the threshold is
  // >1, not >0, to allow that case while still blocking a tap that lands
  // after other characters (length was already >=1 before the tap's own
  // character was appended, so it's >=2 after).
  interruptManager.setActivationGuard(() => {
    try {
      return ((rl as unknown as { line?: string }).line?.length ?? 0) > 1;
    } catch {
      return false;
    }
  });
  // Strip the stray Tab character back out before recording starts, so it
  // doesn't sit unseen in the line buffer and get prepended to whatever
  // the user types next if they abandon voice input mid-tap.
  interruptManager.setPreActivationCleanup(() => {
    try {
      rl.write(null, { ctrl: true, name: "u" } as never);
    } catch {
      // best-effort cosmetic cleanup — never block activation on it
    }
  });

  console.log("\nVoice mode on. Tap Tab to speak, or type a task and press enter. Ctrl+C to exit.\n");

  let nextTask: string | undefined = initialTask;

  try {
    while (true) {
      const task = nextTask ?? (await waitForNextInput(rl, interruptManager));
      nextTask = undefined;

      if (!task || !task.trim()) {
        console.log("[voice] no task to run — back to listening.");
        continue;
      }
      if (/^(exit|quit)$/i.test(task.trim())) break;

      try {
        const harness = await createHarness(task);
        const finalText = await runVoiceTurn(task, { interruptManager, harness, ...deps });
        console.log(`\n=== Final response ===\n${finalText}\n`);
      } catch (err: any) {
        if (err instanceof TurnInterrupted) {
          nextTask = await err.followUpTask;
          continue;
        }
        console.log(`\n[voice] task ended with an error: ${err.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

function waitForNextInput(rl: Interface, interruptManager: InterruptManager): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;

    const onLine = (line: string) => {
      if (settled) return;
      settled = true;
      interruptManager.setTapHandler(null);
      resolve(line);
    };

    const onTap = () => {
      if (settled) return;
      void (async () => {
        const text = await captureFollowUp();
        if (settled || !text) return;
        settled = true;
        rl.off("line", onLine);
        interruptManager.setTapHandler(null);
        resolve(text);
      })();
    };

    rl.once("line", onLine);
    interruptManager.setTapHandler(onTap);
  });
}
