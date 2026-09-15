import { createReadStream } from "node:fs";
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

// Sends the recorded clip to /v1/audio/transcriptions (Whisper) and returns
// the transcript. Throws on failure (network error, API error) rather than
// swallowing it — the caller decides whether to retry or surface it to the
// user. The transcript then becomes the task text fed into the same agent
// loop /v1/responses drives (see openai-provider.ts) — a separate call,
// since /v1/responses itself does not accept audio input.
export async function transcribe(filePath: string): Promise<string> {
  const client = getClient();
  try {
    const response = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-1",
    });
    return response.text.trim();
  } catch (err: any) {
    throw new Error(`Transcription failed: ${err?.message ?? String(err)}`);
  }
}
