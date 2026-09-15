import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

const TTS_MODEL = "tts-1";
const TTS_VOICE = "alloy";

interface QueueSlot {
  index: number;
  text: string;
  status: "pending" | "ready";
  audioFilePath?: string;
  ttsController: AbortController;
}

function pickPlayer(): { bin: string; args: (file: string) => string[] } {
  if (process.platform === "darwin") {
    return { bin: "afplay", args: (f) => [f] };
  }
  // mpv (not aplay) so mp3 output from the TTS API plays directly, without
  // an extra decode step.
  return { bin: "mpv", args: (f) => ["--no-terminal", "--really-quiet", f] };
}

// Sentence chunking happens in voice-session.ts, which calls
// enqueueSentence() as soon as each complete sentence is available. This
// class owns everything after that: firing TTS immediately per sentence,
// and playing the results back strictly in order regardless of which
// synthesis call finishes first.
export class SpeechQueue {
  private slots: QueueSlot[] = [];
  private nextIndexToPlay = 0;
  private playing = false;
  private currentPlaybackProcess: ChildProcess | null = null;
  private client: OpenAI;
  private readyWaiters: Array<() => void> = [];
  // Bumped by drainAndStop() so any in-flight playback worker started
  // before the drain notices it's stale and stops touching shared state
  // (nextIndexToPlay, slots) instead of corrupting whatever comes after.
  private generation = 0;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  enqueueSentence(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const slot: QueueSlot = {
      index: this.slots.length,
      text: trimmed,
      status: "pending",
      ttsController: new AbortController(),
    };
    this.slots.push(slot);
    void this.synthesize(slot);

    if (!this.playing) {
      this.playing = true;
      void this.runPlaybackWorker();
    }
  }

  private async synthesize(slot: QueueSlot): Promise<void> {
    try {
      const response = await this.client.audio.speech.create(
        { model: TTS_MODEL, voice: TTS_VOICE, input: slot.text, response_format: "mp3" },
        { signal: slot.ttsController.signal }
      );
      if (slot.ttsController.signal.aborted) return;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (slot.ttsController.signal.aborted) return;

      const filePath = join(tmpdir(), `voice-agent-tts-${randomUUID()}.mp3`);
      await writeFile(filePath, buffer);

      if (slot.ttsController.signal.aborted) {
        await unlink(filePath).catch(() => {});
        return;
      }
      slot.audioFilePath = filePath;
      slot.status = "ready";
    } catch (err: any) {
      if (slot.ttsController.signal.aborted) return;
      console.error(`[voice] TTS failed for a sentence, skipping it: ${err?.message ?? String(err)}`);
      slot.status = "ready"; // no audioFilePath — the playback worker just skips it
    } finally {
      this.notifyReadyWaiters();
    }
  }

  private notifyReadyWaiters(): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
  }

  private waitForReady(slot: QueueSlot): Promise<void> {
    if (slot.status === "ready") return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (slot.status === "ready") resolve();
        else this.readyWaiters.push(check);
      };
      check();
    });
  }

  // Strictly sequential: always plays by index order, never by arrival
  // order. Runs as a self-driving loop once started by enqueueSentence.
  private async runPlaybackWorker(): Promise<void> {
    const myGeneration = this.generation;

    while (this.generation === myGeneration && this.nextIndexToPlay < this.slots.length) {
      const slot = this.slots[this.nextIndexToPlay];
      await this.waitForReady(slot);
      if (this.generation !== myGeneration) break;

      if (slot.audioFilePath) {
        await this.play(slot.audioFilePath);
      }
      if (this.generation !== myGeneration) break;

      this.nextIndexToPlay += 1;
    }

    if (this.generation === myGeneration) this.playing = false;
  }

  private play(filePath: string): Promise<void> {
    return new Promise((resolve) => {
      const { bin, args } = pickPlayer();
      const child = spawn(bin, args(filePath), { stdio: "ignore" });
      this.currentPlaybackProcess = child;

      const done = () => {
        if (this.currentPlaybackProcess === child) this.currentPlaybackProcess = null;
        resolve();
      };
      child.on("exit", done);
      child.on("error", (err) => {
        console.error(`[voice] playback failed (is ${bin} installed?): ${err.message}`);
        done();
      });
    });
  }

  // Safe to call at any time, including when the queue is empty or already
  // fully drained. Cancels every not-yet-ready TTS request, kills any
  // in-flight playback, and empties the queue so nothing queued before the
  // call ever starts speaking after it.
  drainAndStop(): void {
    this.generation += 1;

    for (const slot of this.slots) {
      if (slot.status === "pending") slot.ttsController.abort();
    }
    if (this.currentPlaybackProcess) {
      this.currentPlaybackProcess.kill();
      this.currentPlaybackProcess = null;
    }

    this.slots = [];
    this.nextIndexToPlay = 0;
    this.playing = false;
    this.notifyReadyWaiters();
  }
}
