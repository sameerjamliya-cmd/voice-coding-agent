import { resolve } from "node:path";

// Structural normalization, hand-written per tool — never fuzzy/semantic
// matching. Conservative by default: cosmetic variation collapses to the
// same key, but any difference in target or scope must produce a
// different key. When unsure, this file should err toward MORE distinct
// keys, not fewer — a false "same pattern" match skips a safety prompt on
// a genuinely different, possibly destructive, action.

const FILE_TARGET_TOOLS = new Set(["write_file", "edit_file", "delete_file", "create_directory"]);

// Commands whose bare (non-flag) arguments are filesystem targets worth
// resolving to an absolute path for comparison. Left deliberately small:
// for any command not in this list, arguments are compared as literal
// strings rather than guessed at as paths.
const PATH_ARG_COMMANDS = new Set(["rm", "mv", "cp", "mkdir", "rmdir", "touch", "cat", "chmod"]);

export function normalizeToolCall(toolName: string, input: any, cwd: string): string {
  if (toolName === "run_command" && typeof input?.command === "string") {
    return normalizeRunCommand(input.command, cwd);
  }
  if (toolName === "move_file") {
    return `move_file:${resolve(cwd, input?.from ?? "")}->${resolve(cwd, input?.to ?? "")}`;
  }
  if (FILE_TARGET_TOOLS.has(toolName)) {
    return `${toolName}:${resolve(cwd, input?.path ?? "")}`;
  }
  // No hand-written rule for this tool yet — fall back to the full input,
  // which only ever matches an identical future call (conservative).
  return `${toolName}:${JSON.stringify(input)}`;
}

export function normalizeRunCommand(command: string, cwd: string): string {
  const tokens = tokenize(command);
  if (tokens.length === 0) return "run_command:(empty)";

  // `npm run <script>` and `npm <script>` are the same action.
  if (tokens[0] === "npm" && tokens[1] === "run" && tokens.length > 2) {
    tokens.splice(1, 1);
  }

  const base = tokens[0];
  const resolvePathArgs = PATH_ARG_COMMANDS.has(base);

  const canonical = tokens.map((token, i) => {
    if (i === 0) return token;
    if (token.startsWith("-")) return normalizeFlag(token);
    return resolvePathArgs ? resolve(cwd, token) : token;
  });

  return `run_command:${canonical.join(" ")}`;
}

// Bundled short flags are order-independent (-rf === -fr); long flags
// (--force) are left as literal tokens.
function normalizeFlag(token: string): string {
  if (token.startsWith("--")) return token;
  if (/^-[a-zA-Z]+$/.test(token)) {
    return "-" + [...token.slice(1)].sort().join("");
  }
  return token;
}

// Minimal shell-like tokenizer: splits on whitespace, respects quotes.
// Good enough for canonicalizing the commands harness itself constructs
// approval prompts around — not a full shell parser.
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);

  return tokens;
}
