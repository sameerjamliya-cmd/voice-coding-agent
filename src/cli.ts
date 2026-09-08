#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runLoop } from "./agent/loop.js";
import { selectProvider } from "./llm/select-provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { Harness } from "./harness/harness.js";
import { runUndo } from "./harness/undo.js";
import { closePrompt } from "./shared/terminal-prompt.js";

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

function buildRegistry(): ToolRegistry {
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

  return registry;
}

const program = new Command();

program.name("agent").description("Voice coding agent CLI (Phase 2: loop + harness)");

program
  .command("run", { isDefault: true })
  .description("Run a task")
  .argument("<task>", "task for the agent to perform")
  .option("--token-budget <n>", "soft token budget for this task before prompting", (v) => Number(v))
  .option("--hard-ceiling-multiplier <n>", "hard-stop multiple of the token budget", (v) => Number(v))
  .action(async (task: string, opts: { tokenBudget?: number; hardCeilingMultiplier?: number }) => {
    const registry = buildRegistry();
    const harness = await Harness.create(registry, {
      task,
      cwd: ".",
      configOverrides: {
        tokenBudget: opts.tokenBudget,
        hardCeilingMultiplier: opts.hardCeilingMultiplier,
      },
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
            break;
          case "checkpoint_failed":
            console.log("[harness] checkpoint failed.");
            break;
          case "rollback":
            console.log(`[harness] rolled back to ${event.sha.slice(0, 8)}`);
            break;
        }
      },
    });

    try {
      const provider = selectProvider();
      const finalText = await runLoop({
        task,
        registry,
        provider,
        harness,
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
      closePrompt();
    } catch (err: any) {
      await harness.endSession?.("abandoned");
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

program.parse();
