---
name: documentation-comments
description: Comment on why code does something non-obvious, not what it does when that's already clear from reading it.
always_on: false
---

# Documentation Comments

## Rules

1. Write a comment when the *why* behind a decision isn't obvious from
   the code itself (a workaround for a specific bug, a non-obvious
   business rule, a deliberate tradeoff) — not to restate what the code
   already clearly says.
2. Avoid comments that just narrate the next line in different words —
   if removing the comment loses no information, it shouldn't be there.
3. For exported/public functions where the project already uses a
   doc-comment convention (JSDoc, docstrings, etc.), follow that
   existing convention for new additions rather than a different style.
4. Keep comments up to date with the code — a comment describing
   behavior that no longer matches the code below it is worse than no
   comment at all.

## Anti-pattern (do not do this)

```typescript
// increment count by 1
count = count + 1;
```
Adds nothing the code doesn't already say.

## Correct pattern

```typescript
// Retry count starts at 1, not 0, because the first attempt already
// happened before this loop begins — see the caller in retry.ts
count = count + 1;
```
Explains a non-obvious reason, which the code alone couldn't convey.

## When to use this skill

Any task that involves writing new code where a genuinely non-obvious
decision, workaround, or business rule is involved.
