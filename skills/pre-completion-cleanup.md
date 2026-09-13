---
name: pre-completion-cleanup
description: Remove debug residue and dead code before calling mark_task_complete.
always_on: true
---

# Pre-Completion Cleanup

## Rules

1. Before calling `mark_task_complete`, search your own changes for
   debug artifacts: `console.log`/`print` statements added for your own
   investigation, temporary variables used only for inspection, and
   commented-out old code left behind after an edit.
2. Remove any code you added purely to help yourself understand the
   problem, unless it's a legitimate, permanent log statement following
   the project's actual logging conventions (see
   `error-handling-and-logging`).
3. If you commented out old code instead of deleting it "just in case,"
   delete it — git history already preserves the old version; dead
   commented code left in the file is noise, not a safety net.
4. This is a final pass, distinct from `code-review` — code-review
   checks quality of the logic; this checks for leftover debugging
   mess.

## Anti-pattern (do not do this)

```typescript
function calculateTotal(items: Item[]) {
  console.log("items:", items); // left over from debugging
  const total = items.reduce((sum, i) => sum + i.price, 0);
  // const oldTotal = items.length * averagePrice; // old approach, commented out
  console.log("total:", total); // left over from debugging
  return total;
}
```

## Correct pattern

```typescript
function calculateTotal(items: Item[]) {
  return items.reduce((sum, i) => sum + i.price, 0);
}
```

## When to use this skill

Every task, as a final pass immediately before `mark_task_complete` —
same timing as `code-review`, checking a different concern.
