import { resolve } from "node:path";

// A pattern-matching tripwire against run_command inputs, not a guarantee
// of safety — a second, automated check alongside the approval gate,
// because repeated human review of raw command text has a known failure
// rate (skimming, fatigue). Targets well-known, high-confidence-of-harm
// constructs; not exhaustive, not comprehensive shell-semantics analysis.
// A match never blocks outright — see harness.ts, every match escalates
// to the user via the same ask_user choice() mechanism used everywhere
// else in harness. This module only decides whether something matched.
export interface DenylistMatch {
  name: string;
  category: string;
  reason: string;
}

interface DenylistRule {
  name: string;
  pattern: RegExp;
  category: string;
  reason: string;
}

const RULES: DenylistRule[] = [
  {
    name: "rm_no_preserve",
    category: "destructive filesystem",
    pattern: /\brm\b[^\n]*--no-preserve-root/i,
    reason: "explicitly disables rm's built-in safety check against deleting the root filesystem",
  },
  {
    name: "rm_rf_root",
    category: "destructive filesystem",
    pattern: /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\/|~|\$HOME)(?:\s|$)/i,
    reason: "recursive/force delete targeting the filesystem root or home directory",
  },
  {
    name: "rm_rf_wildcard",
    category: "destructive filesystem",
    pattern: /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\*|\.)(?:\s|$)/i,
    reason: "recursive/force delete at a wildcard or whole-directory scope",
  },
  {
    name: "sudo_su",
    category: "privilege escalation",
    pattern: /\b(sudo|doas)\b|\bsu\b/i,
    reason: "a coding agent has no legitimate need for elevated system privileges to edit a project",
  },
  {
    name: "pipe_to_shell",
    category: "remote code execution",
    pattern: /(curl|wget)[^|;\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    reason: "fetches remote content and executes it immediately — a common malware/supply-chain installation pattern",
  },
  {
    name: "device_write",
    category: "destructive device operations",
    pattern: /\bdd\b[^\n]*\bof=\/dev\/|\bmkfs(?:\.\w+)?\b|>\s*\/dev\/(?:sd|nvme|hd|disk)\w*/i,
    reason: "no legitimate use case for a coding agent to write directly to a device file",
  },
  {
    name: "fork_bomb",
    category: "resource exhaustion",
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "self-referencing background-process pattern that exhausts system resources",
  },
  {
    name: "git_force_push",
    category: "destructive git operations",
    pattern: /\bgit\s+push\b[\s\S]*?(?:--force(?:-with-lease)?\b|\s-f\b)/i,
    reason: "overwrites remote history, potentially destroying others' work irrecoverably",
  },
  {
    name: "git_clean_force",
    category: "destructive git operations",
    pattern: /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d[a-zA-Z]*\b|\bgit\s+clean\s+-[a-zA-Z]*d[a-zA-Z]*f[a-zA-Z]*\b/i,
    reason: "force-removes untracked files and directories with no recovery",
  },
  {
    name: "ssh_key_read",
    category: "credential file access",
    pattern: /\b(cat|less|more|head|tail)\b[^\n]*\.ssh\/(id_rsa|id_ed25519|id_ecdsa|id_dsa)\b/i,
    reason: "reads a private SSH key",
  },
  {
    name: "cloud_creds_read",
    category: "credential file access",
    pattern:
      /\b(cat|less|more|head|tail)\b[^\n]*(?:\.aws\/credentials|\.config\/gcloud\/|\.azure\/credentials)\b/i,
    reason: "reads cloud provider credentials",
  },
  {
    name: "env_file_read",
    category: "credential file access",
    pattern: /\b(cat|less|more|head|tail)\b[^\n]*(?:^|[\/\s])\.env(?:\.\w+)?\b/i,
    reason: "reads a .env file, which typically contains secrets",
  },
];

export function checkDenylist(command: string, cwd: string): DenylistMatch | null {
  for (const rule of RULES) {
    if (rule.pattern.test(command)) {
      return { name: rule.name, category: rule.category, reason: rule.reason };
    }
  }
  return checkRmTraversal(command, cwd);
}

// Separate from the regex rules above: resolves rm -rf's target path(s)
// and flags anything that lands outside the project directory. Path
// traversal (../../etc, an absolute path elsewhere) can't be caught by a
// fixed substring — it only becomes apparent after resolving against cwd.
function checkRmTraversal(command: string, cwd: string): DenylistMatch | null {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "rm") return null;

  const flagChars = tokens
    .slice(1)
    .filter((t) => t.startsWith("-") && !t.startsWith("--"))
    .map((t) => t.slice(1))
    .join("");
  const hasLongRecursive = tokens.includes("--recursive");
  const hasLongForce = tokens.includes("--force");
  const isForceRecursive = (/r/i.test(flagChars) || hasLongRecursive) && (/f/i.test(flagChars) || hasLongForce);
  if (!isForceRecursive) return null;

  const projectRoot = resolve(cwd);
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) continue;
    const target = resolve(cwd, token);
    if (target !== projectRoot && !target.startsWith(`${projectRoot}/`)) {
      return {
        name: "rm_rf_outside_project",
        category: "destructive filesystem",
        reason: `resolves to "${target}", outside the project directory ("${projectRoot}")`,
      };
    }
  }
  return null;
}
