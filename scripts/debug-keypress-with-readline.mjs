import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

console.log("Combined debug: readline/promises Interface + a separate keypress listener.");
console.log("Type text + Enter to test the Interface. Press Tab to test the keypress listener. Ctrl+C to exit.");

const rl = createInterface({ input: stdin, output: stdout });

// Same order as voice-session.ts: Interface created first, keypress
// listener attached after.
readline.emitKeypressEvents(stdin);
if (stdin.isTTY) stdin.setRawMode(true);
stdin.resume();

stdin.on("keypress", (str, key) => {
  console.log("[keypress]", { str: JSON.stringify(str), name: key?.name });
  if (key?.ctrl && key?.name === "c") process.exit(0);
});

rl.on("line", (line) => {
  console.log("[line]", JSON.stringify(line));
});
