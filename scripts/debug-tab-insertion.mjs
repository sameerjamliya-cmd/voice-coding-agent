import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

console.log("Press Tab a couple times, then Ctrl+C. Watching rl.line after each keypress.");

const rl = createInterface({ input: stdin, output: stdout });
readline.emitKeypressEvents(stdin);
if (stdin.isTTY) stdin.setRawMode(true);
stdin.resume();

stdin.on("keypress", (str, key) => {
  console.log(`\n[after keypress name=${key?.name}] rl.line = ${JSON.stringify(rl.line)} (length ${rl.line?.length})`);
  if (key?.ctrl && key?.name === "c") process.exit(0);
});
