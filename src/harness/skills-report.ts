import { openHarnessDb } from "./db/connection.js";

interface SkillStats {
  loaded_count: number;
  loaded_passed: number;
  baseline_count: number;
  baseline_passed: number;
}

// Lightweight visibility tool, not an experiment framework: queries the
// existing observability tables (load_skill is just a regular tool call,
// already captured in tool_call_attempts — no new logging was needed to
// build this) to show, per skill, the mark_task_complete validation pass
// rate for sessions that loaded it vs. sessions that didn't. Purely
// correlational — see the caveat printed at the end of the report.
export async function runSkillsReport(cwd: string): Promise<void> {
  const db = openHarnessDb(cwd);

  try {
    const skillRows = db
      .prepare(
        `SELECT DISTINCT json_extract(input_json, '$.name') AS skill
         FROM tool_call_attempts
         WHERE tool_name = 'load_skill'`
      )
      .all() as { skill: string | null }[];

    const skills = skillRows.map((r) => r.skill).filter((s): s is string => Boolean(s)).sort();

    if (skills.length === 0) {
      console.log("No load_skill calls recorded yet — nothing to report.");
      return;
    }

    const statement = db.prepare(`
      WITH loaded AS (
        SELECT DISTINCT session_id FROM tool_call_attempts
        WHERE tool_name = 'load_skill' AND json_extract(input_json, '$.name') = ?
      ),
      passed AS (
        SELECT DISTINCT session_id FROM validations WHERE passed = 1
      )
      SELECT
        (SELECT COUNT(*) FROM loaded) AS loaded_count,
        (SELECT COUNT(*) FROM loaded WHERE session_id IN (SELECT session_id FROM passed)) AS loaded_passed,
        (SELECT COUNT(*) FROM sessions WHERE id NOT IN (SELECT session_id FROM loaded)) AS baseline_count,
        (SELECT COUNT(*) FROM sessions WHERE id NOT IN (SELECT session_id FROM loaded)
           AND id IN (SELECT session_id FROM passed)) AS baseline_passed
    `);

    console.log("\nSkill usage report\n");
    const skillCol = Math.max(20, ...skills.map((s) => s.length)) + 2;
    console.log(
      `${"skill".padEnd(skillCol)}${"loaded".padStart(8)}${"pass %".padStart(9)}    ${"baseline pass % (n)"}`
    );
    console.log("-".repeat(skillCol + 8 + 9 + 4 + 22));

    for (const skill of skills) {
      const stats = statement.get(skill) as unknown as SkillStats;
      const loadedRate = stats.loaded_count > 0 ? (stats.loaded_passed / stats.loaded_count) * 100 : 0;
      const baselineRate = stats.baseline_count > 0 ? (stats.baseline_passed / stats.baseline_count) * 100 : 0;

      console.log(
        `${skill.padEnd(skillCol)}${String(stats.loaded_count).padStart(8)}${`${loadedRate.toFixed(0)}%`.padStart(9)}    ` +
          `${baselineRate.toFixed(0)}% (n=${stats.baseline_count})`
      );
    }

    console.log(
      "\nThese numbers are correlational, not causal. Sessions that load a given skill are self-selected " +
        "— a task that loads `debugging`, for example, is a bug-fix task, which is likely already different " +
        "in difficulty from tasks that never load it. A lower pass rate for a skill's sessions does not mean " +
        "the skill is hurting outcomes; it may just mean those tasks are inherently harder. Use this to spot " +
        "gross patterns worth a closer manual look — a skill essentially never loaded may have a " +
        "discovery/description problem, a skill loaded often but paired with an unusually low pass rate may " +
        "be worth investigating — not as an automatic verdict on any skill."
    );
  } finally {
    db.close();
  }
}
