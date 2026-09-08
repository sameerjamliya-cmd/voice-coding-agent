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

// Must be called before the process should exit if any prompt was ever
// issued — an open readline interface keeps the event loop alive.
export function closePrompt(): void {
  rl?.close();
  rl = null;
}
