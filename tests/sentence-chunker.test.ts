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

  it("regression: no sentence is ever chunked twice across a realistic multi-piece stream", () => {
    const sentences = [
      "This is the first sentence.",
      "Here comes the second one.",
      "Now a third sentence arrives.",
      "The fourth sentence follows next.",
      "A fifth sentence keeps going.",
      "Finally the sixth sentence ends it.",
    ];
    const fullText = sentences.join(" ");

    // Small, sentence-sized pieces delivered across many push() calls — the
    // shape of a real multi-event stream, not one big string at once.
    const pieces = sentences.map((s, i) => (i === 0 ? s : ` ${s}`));

    const chunks: string[] = [];
    const chunker = new SentenceChunker();
    for (const piece of pieces) {
      chunker.push(piece, (c) => chunks.push(c));
    }
    chunker.flush((c) => chunks.push(c));

    const transcript = chunks.join(" ").replace(/\s+/g, " ").trim();
    expect(transcript).toBe(fullText);

    // No sentence's distinctive text appears in more than one fired chunk.
    for (const sentence of sentences) {
      const occurrences = chunks.filter((c) => c.includes(sentence)).length;
      expect(occurrences).toBe(1);
    }
  });

  it("regression: a stream-end flush does not re-fire content a boundary check already flushed", () => {
    // Exactly 2 sentences (== SENTENCES_PER_TTS_CHUNK) so push() fires the
    // chunk on its own, leaving the internal buffer empty — flush() must
    // then be a true no-op, not a re-emission of that same content.
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("First sentence here. Second sentence here.", (c) => chunks.push(c));
    expect(chunks).toEqual(["First sentence here. Second sentence here."]);

    chunker.flush((c) => chunks.push(c));
    expect(chunks).toEqual(["First sentence here. Second sentence here."]); // unchanged
  });

  it("flushes a trailing partial sentence (no terminating punctuation) at stream end instead of dropping it", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("First sentence. Second sentence. trailing fragment with no period", (c) => chunks.push(c));
    // The 2 complete sentences fire as a chunk; the fragment is left
    // buffered until flush().
    expect(chunks).toEqual(["First sentence. Second sentence."]);

    chunker.flush((c) => chunks.push(c));
    expect(chunks).toEqual(["First sentence. Second sentence.", "trailing fragment with no period"]);
  });

  it("fires exactly twice for 4 complete sentences, 2 sentences per call, in order", () => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();

    chunker.push("One. Two. Three. Four.", (c) => chunks.push(c));

    expect(chunks).toEqual(["One. Two.", "Three. Four."]);
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

// 22 varied streamed-text patterns exercising the chunking/stripping
// logic together: code blocks in different positions, multiple blocks,
// inline+fenced mixed, unicode, abbreviations that could falsely trigger
// boundary detection, quoted punctuation, and a stream delivered as many
// small pieces vs. one large chunk. Every expected value below was
// verified against the actual implementation, not guessed — several of
// these (the abbreviation cases) surfaced a real content-dropping bug in
// splitIntoSentences's regex (an internal period with no trailing space,
// like "e.g." or "Node.js", caused the character before it to be
// silently dropped) which was fixed as part of adding this coverage.
describe("SentenceChunker — varied patterns (parametrized)", () => {
  const PATTERNS: Array<[string, string, string[]]> = [
    [
      "code block at the start",
      "```js\nconst x = 1;\n``` Explanation follows. Second sentence.",
      ["Explanation follows. Second sentence."],
    ],
    [
      "code block in the middle",
      "Before the code. ```js\nconst x = 1;\n``` After the code.",
      ["Before the code. After the code."],
    ],
    [
      "code block at the end",
      "Explanation first. Then code. ```js\nconst x = 1;\n```",
      ["Explanation first. Then code."],
    ],
    [
      "multiple fenced blocks",
      "First part. ```js\nfoo();\n``` Middle part. ```py\nbar()\n``` Last part.",
      ["First part. Middle part.", "Last part."],
    ],
    [
      "inline code mixed with fenced block",
      "Use `foo()` here. ```js\nbar();\n``` Done.",
      ["Use  here. Done."],
    ],
    [
      "multiple inline code spans",
      "Use `foo()` and `bar()` together. It works.",
      ["Use  and  together. It works."],
    ],
    [
      "unicode accented characters",
      "Café résumé naïve. Second sentence here.",
      ["Café résumé naïve. Second sentence here."],
    ],
    ["unicode emoji", "Emoji test 🎉🎊. Second sentence here.", ["Emoji test 🎉🎊. Second sentence here."]],
    [
      "unicode CJK (no ASCII terminator recognized, stays one sentence)",
      "Testing unicode support. 日本語のテスト。Third sentence.",
      ["Testing unicode support. 日本語のテスト。Third sentence."],
    ],
    [
      "abbreviation 'Dr.' — regression for the content-drop fix",
      "Dr. Smith went home. He was tired.",
      ["Dr. Smith went home.", "He was tired."],
    ],
    [
      "abbreviation 'e.g.' — regression for the content-drop fix (previously dropped the leading 'e')",
      "e.g. this is an example. Another sentence follows.",
      ["e.g. this is an example.", "Another sentence follows."],
    ],
    [
      "abbreviation 'Node.js' with no space — regression for the content-drop fix (previously dropped 'I use Node')",
      "I use Node.js version 20. It works well.",
      ["I use Node.js version 20. It works well."],
    ],
    [
      "domain name with no space before '.' — regression for the content-drop fix (previously dropped 'Visit example')",
      "Visit example.com for more info. Thanks.",
      ["Visit example.com for more info. Thanks."],
    ],
    [
      "quoted period inside a sentence",
      'I said "hello." Then I left.',
      ['I said "hello." Then I left.'],
    ],
    ["three sentences, odd count, remainder flushed", "One. Two. Three.", ["One. Two.", "Three."]],
    ["four sentences, exactly two chunks", "One. Two. Three. Four.", ["One. Two.", "Three. Four."]],
    [
      "code block spanning an entire push with no surrounding prose at all",
      "```py\nprint('hi')\n```",
      [],
    ],
    ["empty string produces no chunks", "", []],
    [
      "trailing fragment with no terminating punctuation is still flushed",
      "First sentence. Second sentence. trailing fragment",
      ["First sentence. Second sentence.", "trailing fragment"],
    ],
    [
      "exclamation and question marks as terminators, mixed with periods",
      "Really? Yes! Absolutely.",
      ["Really? Yes!", "Absolutely."],
    ],
  ];

  it.each(PATTERNS)("%s", (_label, input, expected) => {
    const chunks: string[] = [];
    const chunker = new SentenceChunker();
    chunker.push(input, (c) => chunks.push(c));
    chunker.flush((c) => chunks.push(c));
    expect(chunks).toEqual(expected);
  });

  it("streamed as one large chunk vs. many small token-sized pieces: content differs, a known documented limitation", () => {
    // Not a "same input, same output" assertion — it's the opposite,
    // deliberately: this is the documented limitation in voice-session.ts
    // ("operates per push() call... [only] doesn't occur in practice
    // today [because] current providers deliver one complete text block
    // per event, not token-by-token"). Splitting the identical final text
    // across many small push() calls with no terminator inside each piece
    // causes each piece to be treated as its own "sentence" (the
    // no-terminator-found fallback branch), fragmenting the output —
    // this test pins that known, accepted behavior rather than silently
    // letting it drift.
    const wholeText = "This is the first sentence. Here comes the second one.";
    const pieces = ["This ", "is ", "the ", "first ", "sentence. ", "Here ", "comes ", "the ", "second ", "one."];

    const wholeChunks: string[] = [];
    const wholeChunker = new SentenceChunker();
    wholeChunker.push(wholeText, (c) => wholeChunks.push(c));
    wholeChunker.flush((c) => wholeChunks.push(c));
    expect(wholeChunks).toEqual(["This is the first sentence. Here comes the second one."]);

    const streamedChunks: string[] = [];
    const streamedChunker = new SentenceChunker();
    for (const piece of pieces) streamedChunker.push(piece, (c) => streamedChunks.push(c));
    streamedChunker.flush((c) => streamedChunks.push(c));
    expect(streamedChunks).toEqual(["This is", "the first", "sentence. Here", "comes the", "second one."]);

    // Despite the different chunking, no characters were lost — the
    // content-drop bug this session fixed is specifically about
    // characters vanishing, not about chunk boundaries differing.
    expect(streamedChunks.join(" ").replace(/\s+/g, " ")).toBe(wholeChunks.join(" ").replace(/\s+/g, " "));
  });
});
