import { ToolRegistry } from "./registry.js";
import type { Tool } from "../agent/types.js";
import type { Skill } from "../skills/types.js";

import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import { deleteFileTool } from "./delete-file.js";
import { moveFileTool } from "./move-file.js";
import { createDirectoryTool } from "./create-directory.js";
import { listDirectoryTool } from "./list-directory.js";
import { readMultipleFilesTool } from "./read-multiple-files.js";

import { searchFilesTool } from "./search-files.js";
import { getFileOutlineTool } from "./get-file-outline.js";
import { getFileStatsTool } from "./get-file-stats.js";

import { runCommandTool } from "./run-command.js";
import { runTestsTool } from "./run-tests.js";
import { runLinterTool } from "./run-linter.js";
import { typeCheckTool } from "./type-check.js";

import { gitStatusTool } from "./git-status.js";
import { gitDiffTool } from "./git-diff.js";
import { gitLogTool } from "./git-log.js";
import { gitBlameTool } from "./git-blame.js";

import { readPackageManifestTool } from "./read-package-manifest.js";
import { listInstalledPackagesTool } from "./list-installed-packages.js";

import { askUserTool } from "./ask-user.js";
import { markTaskCompleteTool } from "./mark-task-complete.js";
import { createLoadSkillTool } from "./load-skill.js";

// Extracted out of cli.ts (rather than re-exported from it) specifically so
// this can be imported from contexts that must never trigger cli.ts's
// top-level `program.parse()` side effect — e.g. benchmark/runner.ts, which
// runs against its own argv, not the CLI's.
export function buildRegistry(skills: Skill[], mcpTools: Tool[]): ToolRegistry {
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
