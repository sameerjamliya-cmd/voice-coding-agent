#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runLoop } from "./agent/loop.js";
import { selectProvider } from "./llm/select-provider.js";
import { ToolRegistry } from "./tools/registry.js";

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
import { showDiffToUserTool } from "./tools/show-diff-to-user.js";

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
  registry.register(showDiffToUserTool);

  return registry;
}

const program = new Command();

program
  .name("agent")
  .description("Voice coding agent CLI (Phase 1: text loop)")
  .argument("<task>", "task for the agent to perform")
  .action(async (task: string) => {
    const registry = buildRegistry();

    try {
      const provider = selectProvider();
      const finalText = await runLoop({
        task,
        registry,
        provider,
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
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
