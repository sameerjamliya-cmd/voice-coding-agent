// Tripwire against obvious destructive mistakes and well-known dangerous
// shell patterns — not real isolation. Blocks outright, regardless of
// approval state. A denylist can never be exhaustive; this is a safety net,
// not a sandbox (real sandboxing is a deferred future milestone).
const DENYLIST_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-\w*[rf]\w*\s+)*-\w*[rf]\w*\s+\/(\s|$)/i, reason: "recursive/force delete of the filesystem root" },
  { pattern: /\brm\s+-\w*r\w*f\w*\b|\brm\s+-\w*f\w*r\w*\b/i, reason: "recursive force delete (rm -rf)" },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "fork bomb" },
  { pattern: /\bsudo\b/i, reason: "privilege escalation (sudo)" },
  { pattern: /\bsu\s+(-|root)\b/i, reason: "privilege escalation (su)" },
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: "filesystem format" },
  { pattern: /\bdd\s+.*\bif=/i, reason: "raw disk write (dd)" },
  { pattern: /\bchmod\s+(-\w+\s+)*777\b/i, reason: "world-writable permission change" },
  { pattern: /\bchown\s+-R\b/i, reason: "recursive ownership change" },
  { pattern: /(curl|wget)[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: "pipe remote script directly to a shell" },
  { pattern: /\bgit\s+push\s+[^|;&]*--force\b/i, reason: "force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "hard reset (reserved for harness rollback only)" },
  { pattern: /\bgit\s+clean\s+-\w*f\w*/i, reason: "force-clean untracked files" },
  { pattern: />\s*\/dev\/(sd|nvme|hd)\w*/i, reason: "raw block device write" },
  { pattern: /\/etc\/(passwd|shadow|sudoers)\b/i, reason: "system credential/permissions file tampering" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "system power control" },
  { pattern: /\bkill\s+(-9\s+)?1\b/i, reason: "kill the init process" },
  { pattern: /\bdiskutil\s+(erase|partition)/i, reason: "disk erase/partition" },
  { pattern: /\bnpm\s+publish\b/i, reason: "publish a package to a public registry" },
];

export function checkDenylist(command: string): string | null {
  for (const { pattern, reason } of DENYLIST_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}
