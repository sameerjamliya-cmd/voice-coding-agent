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
