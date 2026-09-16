// One-off multi-trial runner — NOT part of the production benchmark.
// Re-runs the given task ids N times each (sequentially, fresh temp dir per
// trial) and reports the pass rate, to check whether a fix produced a real,
// substantial improvement rather than judging off a single non-deterministic
// run. Invoked directly via tsx, not wired into `npm run benchmark`.
import "dotenv/config";
import { runAllTasks } from "./runner.js";

async function main() {
  const args = process.argv.slice(2);
  const trialsFlagIndex = args.indexOf("--trials");
  let trials = 5;
  let taskIds = args;
  if (trialsFlagIndex !== -1) {
    trials = Number(args[trialsFlagIndex + 1]);
    taskIds = [...args.slice(0, trialsFlagIndex), ...args.slice(trialsFlagIndex + 2)];
  }

  if (taskIds.length === 0) {
    console.error("Usage: tsx benchmark/trials.ts <task-id> [<task-id>...] [--trials N]");
    process.exit(1);
  }

  const tally: Record<string, { pass: number; total: number }> = {};
  for (const id of taskIds) tally[id] = { pass: 0, total: 0 };

  for (let trial = 1; trial <= trials; trial++) {
    console.log(`\n===== Trial ${trial}/${trials} =====`);
    const results = await runAllTasks(taskIds);
    for (const result of results) {
      tally[result.taskId].total++;
      if (result.mechanicalPass) tally[result.taskId].pass++;
    }
  }

  console.log("\n===== Trial summary =====");
  for (const id of taskIds) {
    const { pass, total } = tally[id];
    console.log(`${id}: ${pass}/${total} passed (${((pass / total) * 100).toFixed(0)}%)`);
  }
}

main().catch((err) => {
  console.error("TRIALS FAILED:", err);
  process.exit(1);
});
