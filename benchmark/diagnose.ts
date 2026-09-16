// One-off diagnostic runner — NOT part of the production benchmark. Runs a
// single task once, with full instrumentation (system prompt actually sent,
// every assistant_text/tool_call event in order) printed to stdout, so a
// failure can be root-caused against real session data instead of guessed
// at. Not wired into `npm run benchmark`; invoked directly via tsx.
import "dotenv/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop, BASE_SYSTEM_PROMPT, type LoopEvent } from "../src/agent/loop.js";
import { composeSystemPrompt } from "../src/skills/compose-system-prompt.js";
import { Harness } from "../src/harness/harness.js";
import { buildRegistry } from "../src/tools/build-registry.js";
import { loadSkills } from "../src/skills/registry.js";
import { selectProvider } from "../src/llm/select-provider.js";
import { setBenchmarkAutoApprove } from "../src/shared/terminal-prompt.js";
import { TASKS } from "./tasks.js";
import { initGitRepo, commitAll } from "./util.js";

async function main() {
  const taskId = process.argv[2];
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) {
    console.error(`Unknown task id: ${taskId}. Known: ${TASKS.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }

  const skills = await loadSkills();
  const systemPrompt = composeSystemPrompt(BASE_SYSTEM_PROMPT, skills);

  console.log("=".repeat(80));
  console.log("COMPOSED SYSTEM PROMPT (exactly what was sent):");
  console.log("=".repeat(80));
  console.log(systemPrompt);
  console.log("=".repeat(80));

  const tempDir = await mkdtemp(join(tmpdir(), `agent-diagnose-${task.id}-`));
  const originalCwd = process.cwd();

  try {
    process.chdir(tempDir);
    initGitRepo(tempDir);
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\ndist/\nbuild/\n*.log\n", "utf-8");
    await task.setup(tempDir);
    commitAll(tempDir, "benchmark: seed fixture");

    setBenchmarkAutoApprove(true);

    const registry = buildRegistry(skills, []);
    const provider = selectProvider();
    const harness = await Harness.create(registry, { task: task.prompt, cwd: tempDir, benchmarkMode: true });

    let eventIndex = 0;
    const finalText = await runLoop({
      task: task.prompt,
      registry,
      provider,
      harness,
      skills,
      maxIterations: 25,
      onEvent: (event: LoopEvent) => {
        eventIndex++;
        if (event.type === "assistant_text") {
          console.log(`\n--- [event ${eventIndex}] assistant_text ---\n${event.text}`);
        } else if (event.type === "tool_call") {
          console.log(`\n--- [event ${eventIndex}] tool_call: ${event.name} ---\n${JSON.stringify(event.input, null, 2)}`);
        } else if (event.type === "tool_result") {
          const preview = (event.output ?? event.error ?? "").slice(0, 300);
          console.log(`--- [event ${eventIndex}] tool_result (${event.name}) ---\n${preview}`);
        }
      },
    });

    console.log("\n" + "=".repeat(80));
    console.log("FINAL TEXT:", finalText);
    console.log("SESSION ID:", harness.sessionId);
    console.log("TEMP DIR (preserved):", tempDir);
  } finally {
    setBenchmarkAutoApprove(false);
    process.chdir(originalCwd);
  }
}

main().catch((err) => {
  console.error("DIAGNOSTIC FAILED:", err);
  process.exit(1);
});
