import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HarnessConfig {
  tokenBudget?: number;
  hardCeilingMultiplier: number;
}

// A relative safety margin (2x whatever budget you set), not a guessed
// absolute quantity — unlike tokenBudget itself, this has a defensible
// universal default and stays configurable on top of it.
const DEFAULT_HARD_CEILING_MULTIPLIER = 2;

export interface HarnessConfigOverrides {
  tokenBudget?: number;
  hardCeilingMultiplier?: number;
}

// tokenBudget has no default — if it's unset in both the config file and
// CLI flags, token-budget checking is simply off. Guessing a number here
// would be exactly the kind of hardcoded threshold the spec says not to
// invent before real usage data exists.
export async function loadHarnessConfig(cwd: string, overrides: HarnessConfigOverrides = {}): Promise<HarnessConfig> {
  let fileConfig: HarnessConfigOverrides = {};
  try {
    const raw = await readFile(join(cwd, ".voice-agent", "config.json"), "utf-8");
    fileConfig = JSON.parse(raw);
  } catch {
    // No config file — fine, defaults (or CLI overrides) apply.
  }

  return {
    tokenBudget: overrides.tokenBudget ?? fileConfig.tokenBudget,
    hardCeilingMultiplier:
      overrides.hardCeilingMultiplier ?? fileConfig.hardCeilingMultiplier ?? DEFAULT_HARD_CEILING_MULTIPLIER,
  };
}
