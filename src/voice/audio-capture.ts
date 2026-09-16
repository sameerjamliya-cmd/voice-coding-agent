import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RecordingResult {
  filePath: string; // path to a temp .wav file
}

// sox's `silence` effect requires the level to stay continuously above the
// onset threshold for the full onset duration — ordinary speech has enough
// micro-dips (consonants, brief pauses) that a threshold much above ~1% of
// full scale often never gets satisfied for typical laptop-mic RMS levels
// (measurable via `rec -q out.wav trim 0 3 && sox out.wav -n stat`), which
// makes recording hang forever waiting for speech it's already hearing.
// Overridable per-machine/mic via env vars rather than requiring a rebuild.
const SILENCE_THRESHOLD_PERCENT = process.env.VOICE_SILENCE_THRESHOLD ?? "3%";
const SILENCE_STOP_DURATION_SECONDS = process.env.VOICE_SILENCE_DURATION ?? "2.0";

// A hard ceiling so a miscalibrated threshold (too high to ever detect
// onset, or too low to ever detect true silence against ambient noise)
// can't hang recording forever — the same single threshold value drives
// both "start" and "stop" detection, and the right value for one isn't
// always right for the other on every mic/room. Force-stopping via
// SIGTERM is safe: sox's `rec` treats it as "stop now," the same as
// pressing Ctrl+C interactively, and finalizes the file normally rather
// than corrupting it.
const MAX_RECORDING_SECONDS = Number(process.env.VOICE_MAX_RECORDING_SECONDS ?? "20");

// Records via sox's `rec` command, which stops on its own once ~2s of
// silence follows the first sound above threshold — no hand-rolled silence
// detection in JS. `sox`/`rec` must be installed separately (see README).
export function startRecording(signal: AbortSignal): Promise<RecordingResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Recording aborted before it started."));
      return;
    }

    const filePath = join(tmpdir(), `voice-agent-rec-${randomUUID()}.wav`);

    // -q: quiet. `silence 1 0.1 <thresh> 1 <dur> <thresh>`: start recording
    // on the first sound above threshold (after 0.1s), stop once <dur>
    // seconds of audio below threshold follows.
    const child = spawn(
      "rec",
      [
        "-q",
        filePath,
        "silence",
        "1",
        "0.1",
        SILENCE_THRESHOLD_PERCENT,
        "1",
        SILENCE_STOP_DURATION_SECONDS,
        SILENCE_THRESHOLD_PERCENT,
      ],
      { stdio: "ignore" }
    );

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort, { once: true });

    // Not treated as an abort/error — SIGTERM here is a graceful stop, same
    // as sox's own silence-triggered stop, so the exit handler below falls
    // through to a normal resolve() rather than a reject().
    const timeoutHandle = setTimeout(() => {
      console.log(
        `\n[voice] recording reached ${MAX_RECORDING_SECONDS}s without detecting silence — stopping automatically.`
      );
      child.kill("SIGTERM");
    }, MAX_RECORDING_SECONDS * 1000);

    process.stdout.write("● Listening...");

    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeoutHandle);
      process.stdout.write("\r \r");
      reject(new Error(`Failed to start recording — is sox installed? (${err.message})`));
    });

    child.on("exit", (code) => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeoutHandle);
      process.stdout.write("\r \r"); // clear the "● Listening..." indicator

      if (aborted) {
        reject(new Error("Recording was interrupted."));
        return;
      }
      if (code !== 0 && code !== null) {
        reject(new Error(`Recording process exited with code ${code}`));
        return;
      }
      resolve({ filePath });
    });
  });
}
