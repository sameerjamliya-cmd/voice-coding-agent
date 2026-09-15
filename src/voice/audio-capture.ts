import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RecordingResult {
  filePath: string; // path to a temp .wav file
}

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

    // -q: quiet. `silence 1 0.1 3% 1 2.0 3%`: start recording on the first
    // sound above 3% amplitude (after 0.1s), stop once 2.0s of audio below
    // 3% amplitude follows.
    const child = spawn("rec", ["-q", filePath, "silence", "1", "0.1", "3%", "1", "2.0", "3%"], {
      stdio: "ignore",
    });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort, { once: true });

    process.stdout.write("● Listening...");

    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      process.stdout.write("\r \r");
      reject(new Error(`Failed to start recording — is sox installed? (${err.message})`));
    });

    child.on("exit", (code) => {
      signal.removeEventListener("abort", onAbort);
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
