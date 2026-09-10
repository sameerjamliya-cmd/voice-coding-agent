---
name: code-review
description: Self-check checklist to run before calling mark_task_complete.
always_on: true
---

# Code Review (Self-Check)

## Rules — check each before calling `mark_task_complete`

1. **Edge cases**: for any function handling a collection, does it
   correctly handle empty input, a single-element input, and (if
   relevant) duplicate values? State explicitly if any were
   intentionally left unhandled and why.
2. **Error handling**: for any operation that can fail (file I/O,
   network calls, parsing, external input), is failure handled
   explicitly rather than left to throw an unhandled exception?
3. **No magic values**: are there bare numbers or strings with
   non-obvious meaning that should be named constants?
4. **Scope discipline**: does the diff contain only changes related to
   the actual task, with no unrelated drive-by edits mixed in?
5. **Naming**: would a new reader understand what a variable/function
   does from its name alone, without needing to read its
   implementation?

## Anti-pattern (do not do this)

```typescript
// Task: "add a function to calculate the average of a list of scores"

// WRONG — no edge case handling, magic number, unclear name
function calc(s: number[]) {
  return s.reduce((a, b) => a + b) / s.length; // crashes on empty array
}
```

## Correct pattern

```typescript
function calculateAverageScore(scores: number[]): number {
  if (scores.length === 0) {
    throw new Error("Cannot calculate average of an empty score list");
  }
  const sum = scores.reduce((total, score) => total + score, 0);
  return sum / scores.length;
}
```
Empty-input case is explicitly handled (not left to silently produce
`NaN` or crash), the name states what it does, and there's no magic
value needing explanation.

## When to use this skill

Every task, immediately before calling `mark_task_complete` — this is
meant to run as a final pass regardless of task type.
