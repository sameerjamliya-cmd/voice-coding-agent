# voice-coding-agent

An agentic coding loop built on the base `@anthropic-ai/sdk`, with an
optional voice input/output layer (Phase 4) on top of the same text loop.

## Setup

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY (and OPENAI_API_KEY for voice mode)
npm run build
```

### Voice mode prerequisites

Voice mode (`--voice`) needs two things beyond `npm install`:

- **`OPENAI_API_KEY`** in `.env` — used for Whisper transcription (speech-to-text) and
  text-to-speech, separately from `ANTHROPIC_API_KEY`.
- **`sox`**, an external system dependency (not an npm package) providing the `rec`
  command used to record with stop-on-silence:
  - macOS: `brew install sox`
  - Linux: `apt install sox`
- **A command-line audio player**, also external:
  - macOS: `afplay` (built in)
  - Linux: `mpv` (recommended — plays the TTS API's mp3 output directly)

#### Tuning the recording volume threshold

Recording stops on silence via sox's `silence` effect, which needs the mic
level to stay *continuously* above a threshold to register "speech started."
Laptop mics vary a lot — if recording never stops (stuck at
`● Listening...` indefinitely), your speaking volume likely isn't sustaining
above the default `1%` threshold. Check your actual levels with:

```bash
rec -q /tmp/level-test.wav trim 0 3   # records 3s, speak normally
sox /tmp/level-test.wav -n stat       # look at "RMS amplitude"
```

If RMS amplitude is well below `0.01` (1%), lower the threshold further via
env vars (add to `.env` or export before running):

```bash
VOICE_SILENCE_THRESHOLD=0.5%   # onset/offset volume threshold (default: 1%)
VOICE_SILENCE_DURATION=2.0     # seconds of sustained silence before stopping (default: 2.0)
```

## Usage

```bash
npm run dev -- "list the files in this directory"
# or after building:
node dist/cli.js "create a file called hello.txt with the text Hello World"
```

### Voice mode

```bash
node dist/cli.js --voice                          # start in listening state
node dist/cli.js --voice "list the files here"     # run one task by voice, then keep listening
```

Voice is layered on top of the same text loop — typed input keeps working
at any point in a voice session (hybrid, not voice-only). Tap **Tab** to
start speaking; recording stops automatically after ~2s of silence. (Tab,
not spacebar — readline's own line editor always sees a keypress before
InterruptManager does, on the same stdin stream, so a printable key like
space can't be reliably distinguished from "space typed as part of a
sentence." Tab isn't inserted as a character by readline, so it never
collides with typed input.) Tapping again while the agent is speaking or
working interrupts it: it cuts off audio immediately, cancels an in-flight
response from the model immediately, but never aborts a tool call that's
actively running (a run_command, write_file, etc. in progress) — the tap is
queued until that call returns. Type `exit` or `quit`, or press Ctrl+C, to
leave voice mode.
