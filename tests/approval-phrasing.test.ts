import { describe, it, expect } from "vitest";
import { generateSpokenApprovalPrompt } from "../src/voice/approval-phrasing.js";

describe("generateSpokenApprovalPrompt", () => {
  it("phrases edit_file with a line-count detail when diff context is available", () => {
    const text = generateSpokenApprovalPrompt(
      "edit_file",
      { path: "utils.ts" },
      { linesChanged: 3 }
    );
    expect(text).toBe("Edit utils.ts — 3 lines changed. Approve?");
  });

  it("phrases edit_file with singular wording for exactly one line", () => {
    const text = generateSpokenApprovalPrompt("edit_file", { path: "utils.ts" }, { linesChanged: 1 });
    expect(text).toBe("Edit utils.ts — 1 line changed. Approve?");
  });

  it("phrases edit_file with no detail when diff context is unavailable", () => {
    const text = generateSpokenApprovalPrompt("edit_file", { path: "utils.ts" });
    expect(text).toBe("Edit utils.ts. Approve?");
  });

  it("phrases write_file as Create for a new file", () => {
    const text = generateSpokenApprovalPrompt("write_file", { path: "new.txt" }, { linesChanged: 2, isNewFile: true });
    expect(text).toBe("Create new.txt. Approve?");
  });

  it("phrases write_file as Overwrite for an existing file", () => {
    const text = generateSpokenApprovalPrompt(
      "write_file",
      { path: "existing.txt" },
      { linesChanged: 4, isNewFile: false }
    );
    expect(text).toBe("Overwrite existing.txt. Approve?");
  });

  it("defaults write_file to Create when diff context is unavailable", () => {
    const text = generateSpokenApprovalPrompt("write_file", { path: "new.txt" });
    expect(text).toBe("Create new.txt. Approve?");
  });

  it("phrases delete_file", () => {
    expect(generateSpokenApprovalPrompt("delete_file", { path: "old.txt" })).toBe("Delete old.txt. Approve?");
  });

  it("phrases move_file", () => {
    expect(generateSpokenApprovalPrompt("move_file", { from: "a.ts", to: "b.ts" })).toBe(
      "Rename a.ts to b.ts. Approve?"
    );
  });

  it("phrases run_command with the literal command, never paraphrased", () => {
    const command = "rm -rf node_modules && npm install";
    expect(generateSpokenApprovalPrompt("run_command", { command })).toBe(`Run: ${command}. Approve?`);
  });

  // 30+ combinations crossing each tool type from approval-phrasing.ts
  // with representative input variations: with/without diffContext, a
  // short vs. long path, singular/plural/zero line counts, new vs.
  // overwrite, and several distinct representative run_command strings —
  // asserting the exact deterministic output string for each.
  const COMBINATIONS: Array<[string, string, any, any, string]> = [
    ["edit_file, short path, 1 line changed", "edit_file", { path: "a.ts" }, { linesChanged: 1 }, "Edit a.ts — 1 line changed. Approve?"],
    ["edit_file, short path, 2 lines changed", "edit_file", { path: "a.ts" }, { linesChanged: 2 }, "Edit a.ts — 2 lines changed. Approve?"],
    ["edit_file, short path, 0 lines changed", "edit_file", { path: "a.ts" }, { linesChanged: 0 }, "Edit a.ts — 0 lines changed. Approve?"],
    ["edit_file, short path, many lines changed", "edit_file", { path: "a.ts" }, { linesChanged: 250 }, "Edit a.ts — 250 lines changed. Approve?"],
    ["edit_file, long nested path, no diffContext", "edit_file", { path: "src/deeply/nested/module/utils/helpers.ts" }, undefined, "Edit src/deeply/nested/module/utils/helpers.ts. Approve?"],
    ["edit_file, long nested path, with diffContext", "edit_file", { path: "src/deeply/nested/module/utils/helpers.ts" }, { linesChanged: 5 }, "Edit src/deeply/nested/module/utils/helpers.ts — 5 lines changed. Approve?"],
    ["edit_file, missing path entirely", "edit_file", {}, { linesChanged: 3 }, "Edit the file — 3 lines changed. Approve?"],
    ["edit_file, isNewFile present but irrelevant to edit_file phrasing", "edit_file", { path: "a.ts" }, { linesChanged: 4, isNewFile: true }, "Edit a.ts — 4 lines changed. Approve?"],

    ["write_file, new file, short path", "write_file", { path: "new.txt" }, { linesChanged: 2, isNewFile: true }, "Create new.txt. Approve?"],
    ["write_file, overwrite, short path", "write_file", { path: "existing.txt" }, { linesChanged: 4, isNewFile: false }, "Overwrite existing.txt. Approve?"],
    ["write_file, no diffContext defaults to Create", "write_file", { path: "new.txt" }, undefined, "Create new.txt. Approve?"],
    ["write_file, diffContext without isNewFile defaults to Create", "write_file", { path: "new.txt" }, { linesChanged: 10 }, "Create new.txt. Approve?"],
    ["write_file, long nested path, overwrite", "write_file", { path: "src/config/settings/defaults.json" }, { linesChanged: 1, isNewFile: false }, "Overwrite src/config/settings/defaults.json. Approve?"],
    ["write_file, long nested path, new file", "write_file", { path: "src/config/settings/defaults.json" }, { linesChanged: 20, isNewFile: true }, "Create src/config/settings/defaults.json. Approve?"],
    ["write_file, missing path entirely", "write_file", {}, { linesChanged: 1, isNewFile: true }, "Create the file. Approve?"],

    ["delete_file, short path", "delete_file", { path: "old.txt" }, undefined, "Delete old.txt. Approve?"],
    ["delete_file, long nested path", "delete_file", { path: "src/legacy/deprecated/old-module.ts" }, undefined, "Delete src/legacy/deprecated/old-module.ts. Approve?"],
    ["delete_file, missing path entirely", "delete_file", {}, undefined, "Delete the file. Approve?"],
    ["delete_file, diffContext present but irrelevant to delete_file phrasing", "delete_file", { path: "old.txt" }, { linesChanged: 5 }, "Delete old.txt. Approve?"],

    ["move_file, short from/to", "move_file", { from: "a.ts", to: "b.ts" }, undefined, "Rename a.ts to b.ts. Approve?"],
    ["move_file, long nested from/to", "move_file", { from: "src/old/location/file.ts", to: "src/new/location/file.ts" }, undefined, "Rename src/old/location/file.ts to src/new/location/file.ts. Approve?"],
    ["move_file, missing from", "move_file", { to: "b.ts" }, undefined, "Rename ? to b.ts. Approve?"],
    ["move_file, missing to", "move_file", { from: "a.ts" }, undefined, "Rename a.ts to ?. Approve?"],
    ["move_file, missing both", "move_file", {}, undefined, "Rename ? to ?. Approve?"],

    ["run_command, npm test", "run_command", { command: "npm test" }, undefined, "Run: npm test. Approve?"],
    ["run_command, npm install", "run_command", { command: "npm install left-pad" }, undefined, "Run: npm install left-pad. Approve?"],
    ["run_command, git push", "run_command", { command: "git push origin main" }, undefined, "Run: git push origin main. Approve?"],
    ["run_command, rm -rf, never paraphrased", "run_command", { command: "rm -rf node_modules && npm install" }, undefined, "Run: rm -rf node_modules && npm install. Approve?"],
    ["run_command, compound shell pipeline", "run_command", { command: "curl -s https://example.com | jq .data" }, undefined, "Run: curl -s https://example.com | jq .data. Approve?"],
    ["run_command, missing command entirely", "run_command", {}, undefined, "Run: . Approve?"],
    ["run_command, diffContext present but irrelevant to run_command phrasing", "run_command", { command: "npm test" }, { linesChanged: 3 }, "Run: npm test. Approve?"],

    ["unknown tool falls back to generic Approve phrasing", "some_future_tool", { anything: 1 }, undefined, "Approve some_future_tool?"],
    ["unknown tool with no input at all", "another_tool", {}, undefined, "Approve another_tool?"],
  ];

  it.each(COMBINATIONS)("%s", (_label, toolName, input, diffContext, expected) => {
    expect(generateSpokenApprovalPrompt(toolName, input, diffContext)).toBe(expected);
  });

  it("is pure and deterministic — identical input always produces identical output", () => {
    const cases: Array<[string, any, any?]> = [
      ["edit_file", { path: "utils.ts" }, { linesChanged: 3 }],
      ["write_file", { path: "new.txt" }, { linesChanged: 2, isNewFile: true }],
      ["write_file", { path: "existing.txt" }, { linesChanged: 4, isNewFile: false }],
      ["delete_file", { path: "old.txt" }],
      ["move_file", { from: "a.ts", to: "b.ts" }],
      ["run_command", { command: "npm test" }],
    ];

    for (const [name, input, diffContext] of cases) {
      const first = generateSpokenApprovalPrompt(name, input, diffContext);
      const second = generateSpokenApprovalPrompt(name, input, diffContext);
      expect(second).toBe(first);
    }
  });
});
