import OpenAI from "openai";

// Both providers return raw mp3 bytes — tts-queue.ts owns writing them to a
// temp file and playing them back, so a provider only needs to answer "give
// me audio for this text," nothing about file handling or playback.
export interface TTSProvider {
  synthesize(text: string, signal: AbortSignal): Promise<Buffer>;
}

const OPENAI_TTS_MODEL = "tts-1";
const OPENAI_TTS_VOICE = "alloy";

export class OpenAITTSProvider implements TTSProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    const response = await this.client.audio.speech.create(
      { model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: text, response_format: "mp3" },
      { signal }
    );
    return Buffer.from(await response.arrayBuffer());
  }
}

// ElevenLabs' premade "Rachel" voice — a reasonable default; override via
// ELEVENLABS_VOICE_ID.
const ELEVENLABS_DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

export class ElevenLabsTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string = process.env.ELEVENLABS_VOICE_ID ?? ELEVENLABS_DEFAULT_VOICE_ID) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
        signal,
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

// TTS_PROVIDER selects between OpenAI (default) and ElevenLabs — STT stays
// Whisper-only regardless of this setting; it only affects text-to-speech.
export function createTTSProvider(openAIApiKey: string): TTSProvider {
  if (process.env.TTS_PROVIDER === "elevenlabs") {
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (elevenLabsKey) {
      return new ElevenLabsTTSProvider(elevenLabsKey);
    }
    console.error("[voice] TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set — falling back to OpenAI TTS.");
  }
  return new OpenAITTSProvider(openAIApiKey);
}
