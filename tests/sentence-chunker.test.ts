import { describe, it, expect } from "vitest";
import { SentenceChunker, InterruptFollowUpMailbox } from "../src/voice/voice-session.js";

describe("SentenceChunker", () => {
  it("groups 2 sentences per chunk before firing", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("First sentence. Second sentence. Third sentence.", (c) => chunks.push(c));

    expect(chunks).toEqual(["First sentence. Second sentence."]);
  });

  it("does not fire on a single buffered sentence until flushed", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("Only one sentence here.", (c) => chunks.push(c));
    expect(chunks).toEqual([]);

    chunker.flush((c) => chunks.push(c));
    expect(chunks).toEqual(["Only one sentence here."]);
  });

  it("groups sentences that arrive across separate push() calls", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("First sentence.", (c) => chunks.push(c));
    expect(chunks).toEqual([]); // still buffering, only 1 sentence so far

    chunker.push("Second sentence.", (c) => chunks.push(c));
    expect(chunks).toEqual(["First sentence. Second sentence."]);
  });

  it("flush() is a no-op when nothing is buffered", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("First sentence. Second sentence.", (c) => chunks.push(c));
    chunks.length = 0; // clear what the push already flushed

    chunker.flush((c) => chunks.push(c));
    expect(chunks).toEqual([]);
  });

  it("handles an odd number of sentences across the whole response, flushing the remainder", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("One. Two. Three.", (c) => chunks.push(c));
    chunker.flush((c) => chunks.push(c));

    expect(chunks).toEqual(["One. Two.", "Three."]);
  });

  it("strips a fenced code block from prose before speaking it", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push(
      "I'll fix this by adding a check. ```js\nif (!x) return;\n``` This prevents the crash.",
      (c) => chunks.push(c)
    );
    chunker.flush((c) => chunks.push(c));

    expect(chunks.join(" ")).toBe("I'll fix this by adding a check. This prevents the crash.");
    expect(chunks.join(" ")).not.toContain("if (!x)");
    expect(chunks.join(" ")).not.toContain("```");
  });

  it("strips inline code spans without leaving a placeholder", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("Run the `npm install` command first. Then start the server.", (c) => chunks.push(c));
    chunker.flush((c) => chunks.push(c));

    expect(chunks.join(" ")).toBe("Run the  command first. Then start the server.");
  });

  it("skips a chunk that is entirely a code block with no surrounding prose", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("```js\nconst x = 1;\n```", (c) => chunks.push(c));
    chunker.flush((c) => chunks.push(c));

    expect(chunks).toEqual([]);
  });
});

describe("InterruptFollowUpMailbox", () => {
  it("consume() is atomic: a value can never be consumed more than once", async () => {
    const mailbox = new InterruptFollowUpMailbox();
    mailbox.set(Promise.resolve("do the other thing"), true);

    // Simulate two calls to consume() racing before the captured promise
    // resolves — both start before either has awaited anything.
    const [first, second] = await Promise.all([mailbox.consume(), mailbox.consume()]);

    const definedResults = [first, second].filter((r) => r !== undefined);
    expect(definedResults).toEqual(["do the other thing"]);
  });

  it("a follow-up captured with forInterrupt=false is never returned by consume()", async () => {
    const mailbox = new InterruptFollowUpMailbox();
    mailbox.set(Promise.resolve("next turn's task"), false);

    expect(await mailbox.consume()).toBeUndefined();
    expect(mailbox.takeNonInterrupt()).not.toBeNull();
    expect(await mailbox.takeNonInterrupt()).toBe("next turn's task");
  });
});
