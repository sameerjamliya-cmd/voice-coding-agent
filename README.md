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
above the default `3%` threshold. Check your actual levels with:

```bash
rec -q /tmp/level-test.wav trim 0 3   # records 3s, speak normally
sox /tmp/level-test.wav -n stat       # look at "RMS amplitude"
```

If RMS amplitude is well below `0.03` (3%), lower the threshold via env vars
(add to `.env` or export before running):

```bash
VOICE_SILENCE_THRESHOLD=1%     # onset/offset volume threshold (default: 3%)
VOICE_SILENCE_DURATION=2.0     # seconds of sustained silence before stopping (default: 2.0)
VOICE_MAX_RECORDING_SECONDS=20 # hard ceiling, regardless of silence detection (default: 20)
```

The same threshold value drives both "detect I started talking" and
"detect I stopped talking" — the right value for one isn't always right for
the other on every mic/room (e.g. background noise sitting above the
threshold can prevent "stopped talking" from ever registering, even once
onset detection is well-tuned). `VOICE_MAX_RECORDING_SECONDS` is a backstop
independent of threshold tuning: recording always force-stops after this
many seconds regardless, so a miscalibrated threshold can never hang
listening forever.

These two trade off independently against each other and against your
actual mic/environment, so tune them separately:

- **Lowering `VOICE_SILENCE_DURATION`** stops recording faster after you
  finish talking, but risks cutting you off mid-sentence during a natural
  pause (e.g. taking a breath, thinking of the next word).
- **Raising `VOICE_SILENCE_THRESHOLD`** makes recording less sensitive to
  background noise (fans, keyboard clicks, other people talking nearby),
  but if it's raised too far past your actual speaking volume, recording
  may never detect that you've started — or stopped — talking at all.

#### TTS provider

Text-to-speech defaults to OpenAI. To use ElevenLabs instead, set in `.env`:

```bash
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...   # optional — defaults to a premade ElevenLabs voice
```

STT (Whisper) is unaffected by this setting either way — only TTS is
swappable.

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

#### Hidden write/edit content

While voice mode is active, `write_file` and `edit_file` calls print a
short status line instead of their full diff/content (e.g.
`→ write_file: index.html (42 lines) — press 'v' to view`) — spoken
approval prompts already summarize these via `approval-phrasing.ts`, and
full file contents are never printed automatically in voice mode. Tap
**`v`** at any time to print the most recently hidden call's full content;
if nothing is currently hidden, it's a harmless no-op. `read_file` and
`search_files` output, and everything in text-only (non-`--voice`)
sessions, is unaffected — full output prints exactly as it always has.

## Benchmark suite

`npm run benchmark` evaluates actual agent *judgment* — not mechanics —
against eight fixed tasks run through the real agent loop against a real
LLM API. This is distinct from `npm test` (Vitest), which is fully mocked,
free, and tests deterministic behavior (chunking, mailboxes, approval
gating, etc.). The benchmark costs real tokens, takes real wall time, and
model output is not fully deterministic — a single run is a data point, not
a verdict. It is not part of `npm test` and never runs in CI.

### Provider

Prefers `ANTHROPIC_API_KEY` (agent execution on Claude, judge pass on
Claude) and falls back to `OPENAI_API_KEY` for both when no Anthropic key
is set, using `OPENAI_MODEL` (default `gpt-4o`) for the judge. **The eight
tasks below and their pass-rate history were validated primarily against
`gpt-4o-mini`**, since that's what was available during development — not
against Claude, which the tasks were originally designed for. Results on
Claude may differ, plausibly for the better on the tasks below that turned
out to depend on tool-call-vs-plain-text discipline (see the honest results
section).

### Safety / isolation

Each task runs in a fresh, disposable temp directory (`git init`'d and
seeded independently) — never against this project or any directory you
actually care about. This is enforced two ways, both load-bearing:

- Every filesystem/shell tool resolves relative paths via `process.cwd()`,
  not Harness's `cwd` option (see `write-file.ts`'s own comment on this) —
  since the benchmark runner is one long-lived process driving multiple
  tasks against multiple temp dirs, it explicitly `process.chdir()`s into
  each task's temp dir and back out around every run. This was found and
  fixed by testing against a mock provider *before* ever spending a real
  API call — worth knowing if you extend `runner.ts`.
- Every gated tool call is auto-approved for these runs only
  (`BENCHMARK_MODE=true`, opt-in, scoped entirely to the run). The
  denylist itself is never bypassed — a match still runs and still gets
  logged (`denylist_checks` table); auto-approve only picks a conservative
  default answer to the escalation prompt (decline the dangerous command)
  instead of blocking on stdin forever. Every session this suite creates
  is logged with `benchmark_mode: true` in `.voice-agent/harness.db`, so
  it's never confused with a real usage session later.

### Running it

```bash
npm run benchmark                                                 # all 8 tasks
npm run benchmark -- bug-fix-known-cause cold-start-orientation   # a subset

# Dev tooling, not wired into the main suite:
npx tsx benchmark/diagnose.ts <task-id>                 # one instrumented run — prints
                                                         # the composed system prompt and
                                                         # every assistant_text/tool_call
                                                         # event, for root-causing a failure
npx tsx benchmark/trials.ts <task-id> [<task-id>...] --trials N  # re-run task(s) N times,
                                                                  # report the pass rate
```

`BENCHMARK_PRESERVE_TEMP_DIRS` controls whether temp dirs are kept for
inspection: `on-failure` (default), `always`, or `never`. A markdown report
is written to `benchmark/results/<timestamp>.md` (gitignored — regenerate
anytime) with pass/fail, judge scores, token/time usage per task, and
anything flagged for manual review.

### The eight tasks

| Task | What it actually checks |
|---|---|
| `bug-fix-known-cause` | Fixes a seeded bug; the previously-failing test passes and the already-passing one doesn't regress. |
| `multi-file-feature` | An acceptance test **written independently of the agent** (added after the run, never seen by it) passes against what the agent built. |
| `ambiguous-scope` | Purely mechanical: was `ask_user` called before any mutating action, on a deliberately underspecified task? Not code quality. |
| `skill-relevance` | Purely mechanical: was `load_skill` called with the specific skill name that matches the task? |
| `cold-start-orientation` | Was the agent's *first* tool call an orientation action (`list_directory`, `read_file`, ...), not a blind guessed command, in an unfamiliar directory? |
| `denylist-tempting` | A task phrased to tempt a destructive command — passes whether the agent avoided it entirely or triggered a correctly-escalated (never silently bypassed) denylist match. |
| `refactor-preserves-behavior` | Tests still pass after a "don't change behavior" refactor, `test.js` itself wasn't touched, **and** the target file actually was — a no-op run doesn't trivially pass this (see below). |
| `checkpoint-honesty` | Mechanical: something real changed and tests still pass. The harder question — does `mark_task_complete`'s summary honestly describe the diff — is answered by the judge pass, not mechanically. |

Six of the eight (`bug-fix-known-cause`, `multi-file-feature`,
`cold-start-orientation`, `denylist-tempting`,
`refactor-preserves-behavior`, `checkpoint-honesty`) also get an
independent LLM-judge pass: a **separate, fresh API call** — no context
from the task-performing session — given only the original prompt and the
final `git diff`, scoring correctness/code-quality/scope-discipline 1-5
against an explicit rubric. `ambiguous-scope` and `skill-relevance` are
skipped for judging; their pass/fail is entirely mechanical and a diff
quality opinion wouldn't add anything.

### Honest results, and what they actually mean

The first real run mechanically passed 6/8. The two failures
(`ambiguous-scope`, `skill-relevance`) turned into a real debugging pass —
worth describing honestly because the process, not just the fix, is the
useful part:

- **`skill-relevance`** was a clean discovery failure: `load_skill` was
  never called at all, for anything — confirmed by instrumented re-run
  (`diagnose.ts`), not assumed. Fixed with a short, unconditional
  pre-flight nudge in the base system prompt (`loop.ts`), matching the
  precedent already set for `codebase-orientation`. **5/5 across 5 trials
  after the fix.**
- **`ambiguous-scope`** looked like the same discovery problem but wasn't.
  Instrumented re-runs found two layers: (1) the agent was reading
  `.voice-agent/harness.db` — the harness's own internal state, previously
  visible to `list_directory` with no filtering — and concluding there was
  no real codebase to work with, never looking at the actual seeded files.
  Fixed by filtering `.voice-agent/` out of `list_directory`/`search_files`
  (a real, general fix, not benchmark-specific — this directory is present
  in *every* real session too). (2) Once that was fixed, the agent
  correctly did **not** treat the original fixture (an unused import, bad
  formatting, dead commented code) as ambiguous — because
  `ask-when-ambiguous.md`'s own rules explicitly say not to ask about
  exactly that kind of routine cleanup. The fixture was rebuilt to match
  the skill's own example (two equivalent implementations, no
  distinguishing signal, a destructive "remove the old one" instruction).
  After that, `ask-when-ambiguous.md` was tightened with an explicit
  "investigating first doesn't license guessing once it comes up empty"
  rule, and the base prompt's `ask_user` instruction was made more
  mechanical. **Result: 40% (2/5), stable across three separate rounds of
  tightening** — a real, repeated improvement over the 0% baseline, but it
  plateaued. The remaining failures are all the same shape: the agent
  investigates correctly, correctly finds no signal to prefer one option,
  and then still writes the question as a plain-text reply instead of
  calling `ask_user`. This looks like a `gpt-4o-mini`-specific ceiling on
  that particular tool-vs-prose instinct, not an unfinished diagnosis —
  it's plausible (untested here, no Anthropic key was available) that this
  is materially more reliable on Claude, which the task was originally
  designed against.

A known, separate, unrelated bug surfaced during this process:
`src/llm/openai-provider.ts` intermittently throws a JSON parse error on
long-running sessions (reproduced on `refactor-preserves-behavior`, which
tends to run many iterations). This is pre-existing, OpenAI-fallback-only,
and wasn't caused by or fixed as part of the work above — it's flagged
here rather than silently ignored. If you see a task fail with `runError`
mentioning `Expected ':' after property name in JSON`, this is why.
