---
name: test-driven-fixing
description: Requires a regression test before any bug fix is considered complete.
always_on: false
---

# Test-Driven Fixing

## Rules

1. Before calling `mark_task_complete` on any bug-fix task, a test must
   exist that specifically exercises the original failure condition —
   not just "the test suite passes," but a test that would have caught
   this exact bug if it had existed before the fix.
2. If a relevant test already exists but didn't catch the bug, that
   test itself is incomplete — extend it, don't just add a redundant
   new one.
3. Write the test to fail against the pre-fix behavior conceptually —
   i.e., the assertion should directly encode "this specific bug does
   not happen," not a vague general-purpose check.
4. If the codebase has no test infrastructure at all for the relevant
   area, say so explicitly in your `mark_task_complete` summary rather
   than silently skipping this rule.

## Anti-pattern (do not do this)

```typescript
// Bug: getUserById returns undefined instead of throwing when the user doesn't exist

// WRONG — fix applied, but no test added; nothing prevents regression
function getUserById(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) throw new UserNotFoundError(id);
  return user;
}
// mark_task_complete called here with no test — the fix could silently
// regress in a future change with no signal.
```

## Correct pattern

```typescript
function getUserById(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) throw new UserNotFoundError(id);
  return user;
}

// Test added specifically targeting the original bug:
test("getUserById throws UserNotFoundError for a missing id", () => {
  expect(() => getUserById("does-not-exist")).toThrow(UserNotFoundError);
});
// This test fails against the original buggy version (which returned
// undefined instead of throwing) and passes against the fix — it
// directly encodes the bug that was fixed.
```

## When to use this skill

Every bug-fix task, in combination with `debugging`. Not needed for
pure refactors or new-feature work with no defect involved.
