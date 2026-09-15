import readline from "node:readline";

console.log("Keypress debug — press keys (Tab, space, letters). Ctrl+C to exit.");
console.log("isTTY:", process.stdin.isTTY, "| output isTTY:", process.stdout.isTTY);

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on("keypress", (str, key) => {
  console.log("keypress event ->", { str: JSON.stringify(str), key });
  if (key?.ctrl && key?.name === "c") process.exit(0);
});
