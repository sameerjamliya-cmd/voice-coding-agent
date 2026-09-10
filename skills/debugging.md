---
name: debugging
description: Structured approach for isolating and fixing bugs, before writing any fix.
always_on: false
---

# Debugging

## Rules

1. Before writing any fix, reproduce the failure yourself — run the
   failing test or the exact command that triggers the bug. If you
   cannot reproduce it, say so explicitly rather than guessing at a fix.
2. State your hypothesis for the root cause in one sentence before
   editing any code. If you can't state a specific hypothesis, you
   don't understand the bug well enough to fix it yet — investigate
   further first.
3. Never fix a bug by loosening a check, threshold, or assertion so the
   symptom disappears without understanding why it was tripped.
4. After fixing, re-run the exact reproduction step from rule 1 and
   confirm it now passes. "The error message changed" is not the same
   as "the bug is fixed."
5. Change one thing at a time. If your hypothesis fix doesn't work,
   revert it before trying a different one — don't stack speculative
   changes.

## Anti-pattern (do not do this)

```typescript
// Bug: test expects calculateDiscount(150) to return 15, but it returns 0

// WRONG — silences the symptom without understanding it
function calculateDiscount(amount: number) {
  if (amount > 100) return amount * 0.1;
  return 0.01; // "fixed" — test now passes with a near-zero fallback
}
```
This "fix" makes one specific test pass by returning a number close to
what's expected, without addressing why the original logic returned 0.
It will break on any other input.

## Correct pattern

```typescript
// Investigation: amount > 100 was correct, but the function was never
// being called with the raw amount — it was called with amount / 100
// upstream due to a unit mismatch (cents vs dollars).

// Root cause found. Fix applied at the actual source:
function calculateDiscount(amountInDollars: number) {
  if (amountInDollars > 100) return amountInDollars * 0.1;
  return 0;
}
// Caller fixed to pass dollars, not cents, matching the function's
// actual contract — the real bug (unit mismatch) is now fixed, not
// just this one test case.
```

## When to use this skill

Any task involving: a failing test, a bug report, unexpected output,
or a crash/exception the user wants investigated.
