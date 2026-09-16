#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runLoop } from "./agent/loop.js";
import { selectProvider } from "./llm/select-provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { Harness } from "./harness/harness.js";
import { runUndo } from "./harness/undo.js";
import { runSkillsReport } from "./harness/skills-report.js";
import { closePrompt, setVoiceIO } from "./shared/terminal-prompt.js";
import { assertVoiceEnvReady, runVoiceSession } from "./voice/voice-session.js";
import { InterruptManager } from "./voice/interrupt.js";
import { SpeechQueue } from "./voice/tts-queue.js";
import { createTTSProvider } from "./voice/tts-providers.js";
import { startRecording } from "./voice/audio-capture.js";
import { transcribe } from "./voice/stt.js";

import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { editFileTool } from "./tools/edit-file.js";
import { deleteFileTool } from "./tools/delete-file.js";
import { moveFileTool } from "./tools/move-file.js";
import { createDirectoryTool } from "./tools/create-directory.js";
import { listDirectoryTool } from "./tools/list-directory.js";
import { readMultipleFilesTool } from "./tools/read-multiple-files.js";

import { searchFilesTool } from "./tools/search-files.js";
import { getFileOutlineTool } from "./tools/get-file-outline.js";
import { getFileStatsTool } from "./tools/get-file-stats.js";

import { runCommandTool } from "./tools/run-command.js";
import { runTestsTool } from "./tools/run-tests.js";
import { runLinterTool } from "./tools/run-linter.js";
import { typeCheckTool } from "./tools/type-check.js";

import { gitStatusTool } from "./tools/git-status.js";
import { gitDiffTool } from "./tools/git-diff.js";
import { gitLogTool } from "./tools/git-log.js";
import { gitBlameTool } from "./tools/git-blame.js";

import { readPackageManifestTool } from "./tools/read-package-manifest.js";
import { listInstalledPackagesTool } from "./tools/list-installed-packages.js";

import { askUserTool } from "./tools/ask-user.js";
import { markTaskCompleteTool } from "./tools/mark-task-complete.js";
import { createLoadSkillTool } from "./tools/load-skill.js";
import { loadSkills } from "./skills/registry.js";
import type { Skill } from "./skills/types.js";
import { loadMcpConfig } from "./mcp/config.js";
import { connectMcpServers } from "./mcp/connect-servers.js";
import type { Tool } from "./agent/types.js";

function buildRegistry(skills: Skill[], mcpTools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();

  // File operations
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(deleteFileTool);
  registry.register(moveFileTool);
  registry.register(createDirectoryTool);
  registry.register(listDirectoryTool);
  registry.register(readMultipleFilesTool);

  // Search & code understanding
  registry.register(searchFilesTool);
  registry.register(getFileOutlineTool);
  registry.register(getFileStatsTool);

  // Execution & validation
  registry.register(runCommandTool);
  registry.register(runTestsTool);
  registry.register(runLinterTool);
  registry.register(typeCheckTool);

  // Git (read-only)
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(gitBlameTool);

  // Dependencies (read-only)
  registry.register(readPackageManifestTool);
  registry.register(listInstalledPackagesTool);

  // Interaction
  registry.register(askUserTool);
  registry.register(markTaskCompleteTool);
  registry.register(createLoadSkillTool(skills));

  for (const tool of mcpTools) {
    registry.register(tool);
  }

  return registry;
}

const program = new Command();

program.name("agent").description("Voice coding agent CLI (Phase 2: loop + harness)");

program
  .command("run", { isDefault: true })
  .description("Run a task")
  .argument("[task]", "task for the agent to perform (optional with --voice, which can start in listening state)")
  .option("--token-budget <n>", "soft token budget for this task before prompting", (v) => Number(v))
  .option("--hard-ceiling-multiplier <n>", "hard-stop multiple of the token budget", (v) => Number(v))
  .option("--voice", "enable voice input/output for this session (hybrid — typed input still works)")
  .action(async (task: string | undefined, opts: { tokenBudget?: number; hardCeilingMultiplier?: number; voice?: boolean }) => {
    if (!task && !opts.voice) {
      console.error("Error: a task is required unless --voice is passed.");
      process.exit(1);
    }

    if (opts.voice) {
      try {
        assertVoiceEnvReady();
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    }

    const skills = await loadSkills();

    const mcpConfig = await loadMcpConfig(".");
    const mcp = await connectMcpServers(mcpConfig, (event) => {
      if (event.type === "mcp_connected") {
        console.log(`[mcp] connected to "${event.server}" (${event.toolCount} tool${event.toolCount === 1 ? "" : "s"} allowlisted)`);
      } else {
        console.log(`[mcp] failed to connect to "${event.server}": ${event.error}`);
      }
    });

    const registry = buildRegistry(skills, mcp.tools);

    // Voice mode is set up before the first Harness is built so its onEvent
    // handler below can speak checkpoint pass/fail outcomes through the
    // same speech queue that everything else goes through.
    const speechQueue = opts.voice ? new SpeechQueue(createTTSProvider(process.env.OPENAI_API_KEY!)) : null;
    const interruptManager = speechQueue ? new InterruptManager(speechQueue) : null;
    if (interruptManager && speechQueue) {
      setVoiceIO({
        speak: (text) => speechQueue.enqueueSentence(text),
        listen: async () => {
          const controller = new AbortController();
          const { filePath } = await startRecording(controller.signal);
          return transcribe(filePath);
        },
      });
      // Not started here: startKeyListener() must run after voice-session.ts
      // creates its readline Interface, or the two race to bind Node's
      // (idempotent, first-caller-wins) keypress decoder and the Interface
      // loses — typed input then silently stops producing 'line' events.
    }

    const createHarness = (forTask: string) =>
      Harness.create(registry, {
        task: forTask,
        cwd: ".",
        configOverrides: {
          tokenBudget: opts.tokenBudget,
          hardCeilingMultiplier: opts.hardCeilingMultiplier,
        },
        mcpSourceServers: mcp.sourceServers,
        onEvent: (event) => {
          switch (event.type) {
            case "denylist_match": {
              const label =
                event.decision === "declined"
                  ? "declined"
                  : event.decision === "ran_anyway"
                    ? "ran anyway"
                    : event.decision === "edited_then_ran"
                      ? "edited then ran"
                      : "edited (now clean)";
              console.log(`  ⚠ denylist match "${event.rule.name}" on "${event.command}" — ${label}`);
              break;
            }
            case "checkpoint_running":
              console.log("\n[harness] running checkpoint validation (full test suite)...");
              break;
            case "checkpoint_skipped":
              console.log(`[harness] checkpoint skipped: ${event.reason}`);
              break;
            case "checkpoint_passed":
              console.log("[harness] checkpoint passed.");
              speechQueue?.enqueueSentence("Validation passed.");
              break;
            case "checkpoint_failed":
              console.log("[harness] checkpoint failed.");
              speechQueue?.enqueueSentence("Validation failed. Changes were rolled back.");
              break;
            case "rollback":
              console.log(`[harness] rolled back to ${event.sha.slice(0, 8)}`);
              break;
          }
        },
      });

    if (opts.voice && interruptManager && speechQueue) {
      const provider = selectProvider();
      try {
        await runVoiceSession({
          registry,
          provider,
          skills,
          interruptManager,
          speechQueue,
          createHarness,
          initialTask: task,
        });
        await mcp.close();
        setVoiceIO(null);
        closePrompt();
      } catch (err: any) {
        await mcp.close();
        setVoiceIO(null);
        closePrompt();
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      return;
    }

    const harness = await createHarness(task!);

    try {
      const provider = selectProvider();
      const finalText = await runLoop({
        task: task!,
        registry,
        provider,
        harness,
        skills,
        onEvent: (event) => {
          switch (event.type) {
            case "assistant_text":
              console.log(`\n${event.text}\n`);
              break;
            case "tool_call":
              console.log(`→ ${event.name}(${JSON.stringify(event.input)})`);
              break;
            case "tool_result":
              if (event.error) {
                console.log(`  ✗ ${event.error}`);
              } else {
                const preview = (event.output ?? "").slice(0, 300);
                console.log(`  ✓ ${preview}${(event.output ?? "").length > 300 ? "..." : ""}`);
              }
              break;
          }
        },
      });

      console.log("\n=== Final response ===");
      console.log(finalText);
      await mcp.close();
      closePrompt();
    } catch (err: any) {
      await harness.endSession?.("abandoned");
      await mcp.close();
      closePrompt();
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("undo")
  .description("Undo the agent's most recent change")
  .option("--list", "show recent snapshots and choose one to revert to")
  .action(async (opts: { list?: boolean }) => {
    try {
      await runUndo({ list: Boolean(opts.list), cwd: "." });
      closePrompt();
    } catch (err: any) {
      closePrompt();
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("skills-report")
  .description("Show per-skill load_skill usage vs. mark_task_complete validation pass rate")
  .action(async () => {
    try {
      await runSkillsReport(".");
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
