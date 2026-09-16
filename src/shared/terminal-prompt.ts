import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// A single readline interface for the process lifetime. Creating and
// closing a new one per prompt loses buffered input when stdin is a pipe
// (the second interface can see EOF before it ever gets a 'line' event),
// and would otherwise need explicit closing after every single question.
let rl: Interface | null = null;

function getInterface(): Interface {
  if (!rl) {
    rl = createInterface({ input: stdin, output: stdout });
  }
  return rl;
}

// Voice-mode hook, set once by voice-session.ts for the session's lifetime.
// Every prompt/confirm/choice call in the app goes through this file, so
// registering the hook here is what gives every existing approval/ask_user/
// denylist/budget prompt voice support without touching each call site.
// `speak` only ever receives short, deterministic question text — never raw
// diffs, file contents, or command output. `listen` records + transcribes
// one spoken answer; on failure or a non-match the caller falls back to the
// typed-input path below, keeping this hybrid rather than voice-exclusive.
export interface VoiceIO {
  speak: (text: string) => void;
  listen: () => Promise<string>;
}

let voiceIO: VoiceIO | null = null;

export function setVoiceIO(io: VoiceIO | null): void {
  voiceIO = io;
}

// Lets other modules (harness.ts's approval gate) gate voice-mode-only
// terminal behavior — e.g. suppressing the visual diff/content preview,
// since voice mode approves off the spoken deterministic summary instead —
// without needing their own separate "is voice mode on" plumbing.
export function isVoiceModeActive(): boolean {
  return voiceIO !== null;
}

export async function prompt(question: string): Promise<string> {
  if (voiceIO) {
    voiceIO.speak(question);
    try {
      return await voiceIO.listen();
    } catch (err: any) {
      console.log(`[voice] listen failed (${err.message}) — falling back to typed input.`);
    }
  }
  return getInterface().question(question);
}

export async function confirm(question: string, spokenOverride?: string): Promise<boolean> {
  if (voiceIO) {
    voiceIO.speak(spokenOverride ?? question);
    try {
      const answer = (await voiceIO.listen()).trim().toLowerCase();
      return answer === "y" || answer === "yes" || answer.includes("approve");
    } catch (err: any) {
      console.log(`[voice] listen failed (${err.message}) — falling back to typed input.`);
    }
  }
  const answer = (await getInterface().question(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function matchChoice(raw: string, options: string[]): string | null {
  const num = Number(raw);
  if (Number.isInteger(num) && num >= 1 && num <= options.length) {
    return options[num - 1];
  }

  const lower = raw.toLowerCase();
  const exact = options.find((opt) => opt.toLowerCase() === lower);
  if (exact) return exact;

  const partial = options.filter((opt) => opt.toLowerCase().includes(lower) && lower.length > 0);
  if (partial.length === 1) return partial[0];

  return null;
}

// The shared, reusable pattern for any bounded decision presented to the
// user — ask_user's multi-choice mode and harness's validation-failure
// escalation both go through this. Re-prompts on anything that isn't a
// valid number or an unambiguous match to one option's text, rather than
// guessing at intent. `spokenOverride` lets a caller (e.g. the tool
// approval gate, via approval-phrasing.ts) substitute a short deterministic
// question for voice instead of the terminal's more verbose one.
export async function choice(question: string, options: string[], spokenOverride?: string): Promise<string> {
  const menu = options.map((opt, i) => `  ${i + 1}) ${opt}`).join("\n");

  if (voiceIO) {
    const spokenMenu = options.map((opt, i) => `${i + 1}: ${opt}`).join(". ");
    voiceIO.speak(`${spokenOverride ?? question} Options: ${spokenMenu}.`);
    try {
      const raw = (await voiceIO.listen()).trim();
      const matched = matchChoice(raw, options);
      if (matched) return matched;
      console.log(`[voice] couldn't match "${raw}" to an option — falling back to typed input.`);
    } catch (err: any) {
      console.log(`[voice] listen failed (${err.message}) — falling back to typed input.`);
    }
  }

  while (true) {
    const raw = (await getInterface().question(`\n? ${question}\n\n${menu}\n\n> `)).trim();
    const matched = matchChoice(raw, options);
    if (matched) return matched;
    console.log(`\nPlease enter a number from 1-${options.length}, or one of the option names.`);
  }
}

// Must be called before the process should exit if any prompt was ever
// issued — an open readline interface keeps the event loop alive.
export function closePrompt(): void {
  rl?.close();
  rl = null;
}
