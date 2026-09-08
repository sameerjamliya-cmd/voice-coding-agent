import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createTwoFilesPatch } from "diff";

const CONTEXT_LINES = 3;
const MAX_DELETE_PREVIEW_LINES = 50;

// Renders a tool-appropriate preview for the approval prompt. Only called
// on the manual-approval path — an auto-approved (memory-matched) call
// skips this entirely, per the addendum.
export async function buildApprovalPreview(toolName: string, input: any, cwd: string): Promise<string> {
  switch (toolName) {
    case "edit_file":
      return previewEditFile(input, cwd);
    case "write_file":
      return previewWriteFile(input, cwd);
    case "delete_file":
      return previewDeleteFile(input, cwd);
    case "move_file":
      return previewMoveFile(input);
    case "run_command":
      return previewRunCommand(input);
    default:
      return "";
  }
}

async function previewEditFile(
  input: { path: string; old_string: string; new_string: string },
  cwd: string
): Promise<string> {
  const path = resolve(cwd, input.path ?? "");
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err: any) {
    return `--- ${input.path} ---\n(could not read file for preview: ${err.message})`;
  }

  const matchIndex = content.indexOf(input.old_string);
  if (matchIndex === -1) {
    return `--- ${input.path} ---\n(old_string not found in file — this call will fail)`;
  }

  const lines = content.split("\n");
  const startLine = content.slice(0, matchIndex).split("\n").length - 1;
  const endLine = startLine + input.old_string.split("\n").length - 1;

  const contextBefore = lines.slice(Math.max(0, startLine - CONTEXT_LINES), startLine);
  const contextAfter = lines.slice(endLine + 1, Math.min(lines.length, endLine + 1 + CONTEXT_LINES));

  const body = [
    ...contextBefore.map((l) => ` ${l}`),
    ...input.old_string.split("\n").map((l) => `-${l}`),
    ...input.new_string.split("\n").map((l) => `+${l}`),
    ...contextAfter.map((l) => ` ${l}`),
  ].join("\n");

  return `--- ${input.path} ---\n${body}`;
}

async function previewWriteFile(input: { path: string; content: string }, cwd: string): Promise<string> {
  const path = resolve(cwd, input.path ?? "");
  let oldContent: string | null;
  try {
    oldContent = await readFile(path, "utf-8");
  } catch {
    oldContent = null;
  }

  if (oldContent === null) {
    return `--- ${input.path} (new file) ---\n${input.content}`;
  }

  return createTwoFilesPatch(input.path, input.path, oldContent, input.content, "before", "after");
}

async function previewDeleteFile(input: { path: string }, cwd: string): Promise<string> {
  const path = resolve(cwd, input.path ?? "");
  try {
    const [stats, content] = await Promise.all([stat(path), readFile(path, "utf-8")]);
    const lines = content.split("\n");
    if (lines.length > MAX_DELETE_PREVIEW_LINES) {
      return `--- will delete ${input.path} (${stats.size} bytes, ${lines.length} lines) ---\n(too large to preview in full)`;
    }
    return `--- will delete ${input.path} (${stats.size} bytes) ---\n${content}`;
  } catch (err: any) {
    return `--- will delete ${input.path} ---\n(could not read file: ${err.message})`;
  }
}

function previewMoveFile(input: { from: string; to: string }): string {
  return `${input.from} -> ${input.to}`;
}

function previewRunCommand(input: { command: string }): string {
  return `command: ${input.command}\ndenylist: no match`;
}
