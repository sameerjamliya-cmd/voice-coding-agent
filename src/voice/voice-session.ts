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
import { buildApprovalPreview, computeApprovalDiffContext } from "../harness/diff-preview.js";

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
// string.
function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

// Code embedded in Claude's own reasoning text (not a tool result — those
// are already kept out of speech entirely, see onEvent below) must never
// reach TTS: a fenced block's `.`/`?`/`!` characters would also corrupt
// sentence-boundary detection if left in, so this must run before
// splitIntoSentences, not after. Fenced blocks are stripped before inline
// spans — stripping inline spans first could misparse a fence's own
// triple-backtick markers as a run of empty inline spans.
// Known limitation: this operates per push() call, so a fenced block whose
// opening and closing ``` land in two separate push() calls (only possible
// if a single response's text arrives across multiple assistant_text
// events with a fence straddling them) won't be matched. The current
// providers deliver one complete text block per event, not token-by-token,
// so this doesn't occur in practice today.
export function stripCodeForSpeech(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

const SENTENCES_PER_TTS_CHUNK = 2;

// Groups sentences into 2-sentence chunks before firing a TTS request —
// synthesizing one sentence at a time loses cross-sentence prosody and
// sounds disjointed. The ordered-queue/index mechanics in tts-queue.ts
// don't change: a chunk is just a larger unit of text per queue slot.
// Stateful across calls within one turn so sentence boundaries that split
// across separate assistant_text events still group correctly; call
// flush() once the response is complete to speak whatever's left buffered
// (even a lone sentence) rather than dropping it.
export class SentenceChunker {
  private buffered: string[] = [];

  push(text: string, onChunk: (chunk: string) => void): void {
    const stripped = stripCodeForSpeech(text);
    for (const sentence of splitIntoSentences(stripped)) {
      if (!sentence.replace(/[\s.!?]+/g, "")) continue;
      this.buffered.push(sentence);
      if (this.buffered.length >= SENTENCES_PER_TTS_CHUNK) {
        onChunk(this.buffered.join(" "));
        this.buffered = [];
      }
    }
  }

  flush(onChunk: (chunk: string) => void): void {
    if (this.buffered.length > 0) {
      onChunk(this.buffered.join(" "));
      this.buffered = [];
    }
  }
}

// write_file/edit_file specifically — read_file, search_files, run_command,
// etc. keep printing their full output unchanged, in both voice and text
// sessions. Only these two can dump an entire file's worth of content.
const HIDDEN_IN_VOICE_MODE = new Set(["write_file", "edit_file"]);

// Single most-recent slot, not a history — matches the spec's "press 'v' to
// view" being about the last hidden call, not a browsable log. Reveal
// consumes it (a second 'v' press with nothing new hidden since is a
// harmless no-op), and it's session-scoped (module-level), not per-turn.
let lastHidden: { label: string; content: string } | null = null;

function revealLastHidden(): void {
  if (!lastHidden) return;
  console.log(`\n--- ${lastHidden.label} ---\n${lastHidden.content}\n`);
  lastHidden = null;
}

// Fire-and-forget from onEvent (which is synchronous) — computing the
// diff/preview involves a file read, but nothing downstream needs to wait
// on this before continuing the turn; it only affects what gets printed.
async function displayToolCall(name: string, input: any): Promise<void> {
  if (!HIDDEN_IN_VOICE_MODE.has(name)) {
    console.log(`→ ${name}(${JSON.stringify(input)})`);
    return;
  }

  const cwd = ".";
  const [diffContext, preview] = await Promise.all([
    computeApprovalDiffContext(name, input, cwd),
    buildApprovalPreview(name, input, cwd),
  ]);

  const path = String(input?.path ?? "?");
  const lineCount =
    diffContext?.linesChanged ?? (typeof input?.content === "string" ? input.content.split("\n").length : 0);

  console.log(`→ ${name}: ${path} (${lineCount} line${lineCount === 1 ? "" : "s"}) — press 'v' to view`);
  lastHidden = { label: `${name} ${path}`, content: preview || "(no preview available)" };
}

function displayToolResult(output: string | undefined, error: string | undefined): void {
  if (error) {
    console.log(`  ✗ ${error}`);
    return;
  }
  const preview = (output ?? "").slice(0, 300);
  console.log(`  ✓ ${preview}${(output ?? "").length > 300 ? "..." : ""}`);
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

// Holds the one follow-up recording captured by a tap that landed while a
// tool call was executing, so it can be injected into the next LLM message
// once that tool finishes (see runLoop's consumePendingInterrupt). Exists as
// its own class specifically so `consume()` is atomic and independently
// testable: reading the armed promise and clearing the mailbox must happen
// synchronously, in the same tick, with no `await` between them. If the
// clear happened only after awaiting the captured promise, two calls to
// consume() made before that promise resolves would both see the mailbox
// still armed and both would return (and thus inject) the same transcript —
// the double-processing bug this class exists to prevent.
export class InterruptFollowUpMailbox {
  // `forInterrupt` is true when the tap landed while a tool was executing
  // (this capture is mid-task follow-up, to be injected once the tool
  // finishes); false when it landed with no tool running (an in-flight LLM
  // call was aborted instead, and this capture becomes the *next turn's*
  // task via the catch-path in runVoiceTurn, not an injected interrupt).
  // These two cases are mutually exclusive by construction: only one of
  // consume() / takeNonInterrupt() will ever see a non-null value for a
  // given set() call.
  private capture: Promise<string | undefined> | null = null;
  private forInterrupt = false;

  set(promise: Promise<string | undefined>, forInterrupt: boolean): void {
    this.capture = promise;
    this.forInterrupt = forInterrupt;
  }

  // Atomic read-and-clear, used by the mid-task injection path. Safe to
  // call any number of times — every call after the first (until set()
  // arms it again) returns undefined.
  async consume(): Promise<string | undefined> {
    if (!this.forInterrupt || !this.capture) return undefined;
    const captured = this.capture;
    this.capture = null;
    this.forInterrupt = false;
    return await captured;
  }

  // Used only by the "tap aborted an in-flight LLM call" catch path.
  takeNonInterrupt(): Promise<string | undefined> | null {
    return !this.forInterrupt ? this.capture : null;
  }
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
  const followUpMailbox = new InterruptFollowUpMailbox();

  interruptManager.setTapHandler(() => {
    const wasToolExecuting = interruptManager.handleInterrupt(toolExecutionState.executing);
    followUpMailbox.set(captureFollowUp(), wasToolExecuting);
  });

  const chunker = new SentenceChunker();
  // Set when an assistant_text event arrives with `final: true` — that
  // text is exactly what runLoop's return value (finalText, below) will
  // also carry for a plain-text ending. Without this guard, finalText gets
  // pushed into the chunker a second time after the loop returns,
  // re-enqueuing (and re-speaking) sentences that were already spoken via
  // the onEvent callback during the loop. mark_task_complete/stop/
  // max-iterations endings never set this — their return value was never
  // emitted as an assistant_text event, so they still need the post-loop
  // push below.
  let finalTextAlreadySpoken = false;

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
      // resolve. A tap that landed with no tool running never arms the
      // mailbox for interrupt, so this is a no-op then. See
      // InterruptFollowUpMailbox for why consume() must be atomic.
      consumePendingInterrupt: () => followUpMailbox.consume(),
      onEvent: (event: LoopEvent) => {
        if (event.type === "assistant_text") {
          if (event.final) finalTextAlreadySpoken = true;
          chunker.push(event.text, (chunk) => speechQueue.enqueueSentence(chunk));
        } else if (event.type === "tool_call") {
          void displayToolCall(event.name, event.input);
        } else if (event.type === "tool_result") {
          displayToolResult(event.output, event.error);
        }
        // Only the text spoken through the chunker above ever reaches
        // speechQueue — tool_call/tool_result print to the terminal only
        // (via displayToolCall/displayToolResult), never spoken, since
        // these can carry file contents, diffs, command output, or search
        // results.
      },
    });

    if (!finalTextAlreadySpoken) {
      chunker.push(finalText, (chunk) => speechQueue.enqueueSentence(chunk));
    }
    chunker.flush((chunk) => speechQueue.enqueueSentence(chunk));

    return finalText;
  } catch (err: any) {
    // An in-flight LLM call was aborted by a tap (isToolExecuting was
    // false, so handleInterrupt cancelled it immediately) — the follow-up
    // recording that tap kicked off becomes the next turn's task.
    const nonInterruptCapture = followUpMailbox.takeNonInterrupt();
    if (nonInterruptCapture) {
      throw new TurnInterrupted(nonInterruptCapture);
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

  // 'v' reveals the most recently hidden write_file/edit_file content (see
  // displayToolCall/revealLastHidden above). Attached directly to stdin
  // rather than through InterruptManager since it's unrelated to the
  // activation/interrupt key — it's always live, including mid-approval.
  // 'v' is an ordinary printable character, so readline also inserts it
  // into whatever line is being typed (same as any other letter); typing a
  // word containing 'v' will also trigger a reveal, which is an accepted,
  // low-severity quirk of sharing the input stream this way.
  process.stdin.on("keypress", (_str: string, key: { name?: string; ctrl?: boolean; meta?: boolean } | undefined) => {
    if (key?.name === "v" && !key.ctrl && !key.meta) revealLastHidden();
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
        // Same filter the speech path uses (stripCodeForSpeech, applied to
        // every assistant_text event inside runVoiceTurn/SentenceChunker) —
        // reused here so this summary print never shows code that the
        // spoken response already omitted. No reveal option for this,
        // unlike write_file/edit_file's hide-with-'v' behavior: this is
        // inline prose, not a discrete tool call with content worth
        // storing.
        console.log(`\n=== Final response ===\n${stripCodeForSpeech(finalText)}\n`);
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
