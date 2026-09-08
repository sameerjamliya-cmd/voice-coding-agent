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

export async function prompt(question: string): Promise<string> {
  return getInterface().question(question);
}

export async function confirm(question: string): Promise<boolean> {
  const answer = (await prompt(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

// The shared, reusable pattern for any bounded decision presented to the
// user — ask_user's multi-choice mode and harness's validation-failure
// escalation both go through this. Re-prompts on anything that isn't a
// valid number or an unambiguous match to one option's text, rather than
// guessing at intent.
export async function choice(question: string, options: string[]): Promise<string> {
  const menu = options.map((opt, i) => `  ${i + 1}) ${opt}`).join("\n");

  while (true) {
    const raw = (await prompt(`\n? ${question}\n\n${menu}\n\n> `)).trim();

    const num = Number(raw);
    if (Number.isInteger(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    }

    const lower = raw.toLowerCase();
    const exact = options.find((opt) => opt.toLowerCase() === lower);
    if (exact) return exact;

    const partial = options.filter((opt) => opt.toLowerCase().includes(lower) && lower.length > 0);
    if (partial.length === 1) return partial[0];

    console.log(`\nPlease enter a number from 1-${options.length}, or one of the option names.`);
  }
}

// Must be called before the process should exit if any prompt was ever
// issued — an open readline interface keeps the event loop alive.
export function closePrompt(): void {
  rl?.close();
  rl = null;
}
