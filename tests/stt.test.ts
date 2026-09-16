import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const transcriptionCalls: any[] = [];

vi.mock("openai", () => {
  class MockOpenAI {
    audio = {
      transcriptions: {
        create: vi.fn(async (params: any) => {
          transcriptionCalls.push(params);
          return { text: "  mocked transcript  " };
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(() => "fake-stream" as any) };
});

describe("transcribe()", () => {
  let cwd: string;

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = "fake-key";
    transcriptionCalls.length = 0;
    cwd = await mkdtemp(join(tmpdir(), "voice-agent-stt-test-"));
    const { resetPromptCache } = await import("../src/voice/stt.js");
    resetPromptCache();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("always passes language: 'en' explicitly", async () => {
    const { transcribe } = await import("../src/voice/stt.js");
    await transcribe("/fake/path/clip.wav");

    expect(transcriptionCalls).toHaveLength(1);
    expect(transcriptionCalls[0].language).toBe("en");
  });

  it("includes a prompt built from the actual project directory listing", async () => {
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "distinctive-marker.ts"), "");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const { transcribe } = await import("../src/voice/stt.js");
      await transcribe("/fake/path/clip.wav");
    } finally {
      process.chdir(originalCwd);
    }

    expect(transcriptionCalls).toHaveLength(1);
    expect(typeof transcriptionCalls[0].prompt).toBe("string");
    expect(transcriptionCalls[0].prompt).toContain("distinctive-marker.ts");
    // Known project/command vocabulary is always included alongside
    // whatever files were found, so Whisper is biased toward it too.
    expect(transcriptionCalls[0].prompt).toContain("npm test");
  });

  it("builds the prompt once per session and reuses it on subsequent calls, not rebuilding from disk every time", async () => {
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "reused-marker.ts"), "");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const { transcribe, buildProjectPrompt } = await import("../src/voice/stt.js");
      const buildSpy = vi.fn(buildProjectPrompt);

      await transcribe("/fake/path/clip1.wav");
      const promptAfterFirstCall = transcriptionCalls[0].prompt;

      // Remove the file that produced the marker — if the prompt were
      // rebuilt from disk on the second call, the marker would disappear
      // from it. It shouldn't, because the prompt is cached for the
      // session.
      await rm(join(cwd, "src", "reused-marker.ts"));

      await transcribe("/fake/path/clip2.wav");
      const promptAfterSecondCall = transcriptionCalls[1].prompt;

      expect(promptAfterSecondCall).toBe(promptAfterFirstCall);
      expect(promptAfterSecondCall).toContain("reused-marker.ts");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("trims the returned transcript", async () => {
    const { transcribe } = await import("../src/voice/stt.js");
    const text = await transcribe("/fake/path/clip.wav");
    expect(text).toBe("mocked transcript");
  });
});
