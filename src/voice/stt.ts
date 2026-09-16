import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";

// Separate from ANTHROPIC_API_KEY — voice-session.ts validates this is set
// (with a clear startup error) before voice mode is ever entered, so a
// missing key here would mean that check was skipped.
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set — required for speech-to-text.");
  }
  return new OpenAI({ apiKey });
}

// Whisper's prompt-biasing has a practical length limit and is
// case-sensitive for proper nouns (per OpenAI's docs) — kept short and with
// correct casing preserved for known terms, rather than an exhaustive dump.
const PROMPT_MAX_LENGTH = 800;
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".voice-agent"]);
const KNOWN_COMMANDS = ["npm test", "npm run build", "git status", "git commit", "git diff", "git log", "npx tsc"];

// Built once per session (cached) rather than per recording — the project's
// file layout doesn't change turn to turn, so re-scanning every time would
// just be wasted work on every single tap.
let cachedPrompt: string | null = null;

async function collectFileBasenames(dir: string, depth: number, out: Set<string>): Promise<void> {
  if (depth < 0 || out.size > 60) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await collectFileBasenames(join(dir, entry.name), depth - 1, out);
    } else {
      out.add(entry.name);
    }
    if (out.size > 60) return;
  }
}

// Builds a short, project-aware prompt string biasing Whisper toward this
// project's actual vocabulary — file names and common command names — so
// technical terms transcribe correctly instead of as the nearest everyday
// word. Cached for the session; call resetPromptCache() if the project
// layout changes mid-session (not currently wired to anything — a fresh
// process naturally gets a fresh cache).
export async function buildProjectPrompt(cwd: string = "."): Promise<string> {
  if (cachedPrompt !== null) return cachedPrompt;

  const basenames = new Set<string>();
  await collectFileBasenames(cwd, 2, basenames);

  const terms = [...KNOWN_COMMANDS, ...basenames];
  let prompt = "";
  for (const term of terms) {
    const next = prompt ? `${prompt}, ${term}` : term;
    if (next.length > PROMPT_MAX_LENGTH) break;
    prompt = next;
  }

  cachedPrompt = prompt;
  return prompt;
}

export function resetPromptCache(): void {
  cachedPrompt = null;
}

// Sends the recorded clip to /v1/audio/transcriptions (Whisper) and returns
// the transcript. Throws on failure (network error, API error) rather than
// swallowing it — the caller decides whether to retry or surface it to the
// user. The transcript then becomes the task text fed into the same agent
// loop /v1/responses drives (see openai-provider.ts) — a separate call,
// since /v1/responses itself does not accept audio input.
export async function transcribe(filePath: string): Promise<string> {
  const client = getClient();
  try {
    const prompt = await buildProjectPrompt();
    const response = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-1",
      // Explicit rather than auto-detected — measurably improves accuracy
      // even for English speakers, per Whisper's own guidance.
      language: "en",
      prompt,
    });
    return response.text.trim();
  } catch (err: any) {
    throw new Error(`Transcription failed: ${err?.message ?? String(err)}`);
  }
}
