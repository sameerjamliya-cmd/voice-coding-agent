import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("openai", () => {
  class MockOpenAI {
    audio = { speech: { create: vi.fn() } };
  }
  return { default: MockOpenAI };
});

const { createTTSProvider, OpenAITTSProvider, ElevenLabsTTSProvider } = await import(
  "../src/voice/tts-providers.js"
);

describe("createTTSProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TTS_PROVIDER;
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to OpenAI when TTS_PROVIDER is unset", () => {
    const provider = createTTSProvider("openai-key");
    expect(provider).toBeInstanceOf(OpenAITTSProvider);
  });

  it("uses ElevenLabs when TTS_PROVIDER=elevenlabs and ELEVENLABS_API_KEY is set", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "eleven-key";

    const provider = createTTSProvider("openai-key");
    expect(provider).toBeInstanceOf(ElevenLabsTTSProvider);
  });

  it("falls back to OpenAI when TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is missing", () => {
    process.env.TTS_PROVIDER = "elevenlabs";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = createTTSProvider("openai-key");

    expect(provider).toBeInstanceOf(OpenAITTSProvider);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ELEVENLABS_API_KEY"));
    errorSpy.mockRestore();
  });
});
