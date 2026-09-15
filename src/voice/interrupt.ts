import readline from "node:readline";
import type { SpeechQueue } from "./tts-queue.js";
import type { LLMCallInterrupts } from "../agent/loop.js";

// Tab, not spacebar: readline's own keypress handler (wired up by
// voice-session.ts's Interface) always runs before this class's listener —
// same underlying stream, registration order — so by the time any guard
// here can check "is the user mid-typing", readline has already inserted
// the just-pressed key into its line buffer. Spacebar is a printable
// character readline happily inserts, so every tap (including the very
// first, meant to start recording) would look identical to "space typed as
// part of a sentence" and get blocked. Tab isn't inserted as a character by
// readline when no completer is registered, so it never collides with
// typed text in the first place.
const DEFAULT_ACTIVATION_KEY_NAME = "tab";

// Owns the shared AbortControllers and the always-on raw-stdin keypress
// listener for the activation key (default: Tab). Interruption is tap-based
// only — no continuous voice-activity-detection, no barge-in.
export class InterruptManager implements LLMCallInterrupts {
  private llmController: AbortController | null = null;
  private speechQueue: SpeechQueue;
  // Matched against the keypress event's `key.name` (e.g. "tab", "space",
  // "f1") rather than the raw character, since the activation key is
  // expected to be a named, non-printable key.
  private activationKeyName: string;
  // The current meaning of a tap — swapped by voice-session.ts between
  // "start recording the next task" (idle) and "interrupt the active turn"
  // (mid-turn). Kept as a single mutable slot so the keypress listener,
  // set up once for the session, doesn't need to be re-registered per state.
  private tapHandler: (() => void) | null = null;
  // Optional check consulted before treating a keypress as activation —
  // e.g. voice-session.ts uses this to skip activation while the user is
  // mid-way through typing a line. Necessary even for Tab: readline's own
  // keypress handler (registration order — see startKeyListener()'s doc
  // comment) runs before this class sees the event, and readline inserts
  // Tab as a literal character into its line buffer when no completer is
  // registered. So by the time this guard runs, the just-pressed key has
  // already been appended — voice-session.ts accounts for that one-key lag
  // rather than blocking every tap outright.
  private activationGuard: (() => boolean) | null = null;
  // Called right before a confirmed activation fires, so the caller can
  // strip the stray character readline just inserted (see above) out of
  // its line buffer before recording starts.
  private preActivationCleanup: (() => void) | null = null;

  constructor(speechQueue: SpeechQueue, activationKeyName: string = DEFAULT_ACTIVATION_KEY_NAME) {
    this.speechQueue = speechQueue;
    this.activationKeyName = activationKeyName;
  }

  setTapHandler(handler: (() => void) | null): void {
    this.tapHandler = handler;
  }

  setActivationGuard(guard: (() => boolean) | null): void {
    this.activationGuard = guard;
  }

  setPreActivationCleanup(cleanup: (() => void) | null): void {
    this.preActivationCleanup = cleanup;
  }

  // Called right before every provider.complete() call in the loop.
  beginLLMCall(): AbortSignal {
    const controller = new AbortController();
    this.llmController = controller;
    return controller.signal;
  }

  // Called when the current LLM call completes normally (not aborted).
  endLLMCall(): void {
    this.llmController = null;
  }

  // Call this when the activation key is tapped while the agent is
  // mid-turn (speaking, awaiting a response, or mid-tool-execution).
  // Always drains speech and, if an LLM call is in flight, aborts it
  // outright. Never touches anything tool-related — a running tool call is
  // never aborted. `isToolExecuting` is the caller's own read of the loop's
  // exposed tool-execution flag at the moment of the tap; it's echoed back
  // so the caller has one place to branch on: start recording immediately
  // (false) or queue the new input until the tool call resolves (true).
  handleInterrupt(isToolExecuting: boolean): boolean {
    this.speechQueue.drainAndStop();

    if (this.llmController) {
      this.llmController.abort();
      this.llmController = null;
    }

    return isToolExecuting;
  }

  // Active for the whole voice session, including while the agent is
  // speaking or working — not only when idle waiting for input.
  startKeyListener(): void {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on("keypress", (_str: string, key: { name?: string; ctrl?: boolean } | undefined) => {
      if (key?.ctrl && key?.name === "c") {
        process.exit(0);
      }

      const isActivation = key?.name === this.activationKeyName;
      if (isActivation && !this.activationGuard?.()) {
        this.preActivationCleanup?.();
        this.tapHandler?.();
      }
    });
  }
}
