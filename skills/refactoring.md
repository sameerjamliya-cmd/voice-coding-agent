---
name: refactoring
description: Safe, incremental refactoring procedure that never bundles behavior changes.
always_on: false
---

# Refactoring

## Rules

1. Never combine a refactor (restructuring code without changing
   behavior) with a behavior change (fixing a bug, adding a feature) in
   the same set of edits. If both are genuinely needed, do them as
   clearly separate steps, and say so in your `mark_task_complete`
   summary.
2. After each individual refactoring step, run the type checker or test
   suite before moving to the next step — not just once at the very
   end. If something breaks, you'll know which specific step caused it.
3. Preserve existing public function signatures and exported interfaces
   unless the task explicitly asks you to change them. If a signature
   change seems necessary, flag it via `ask_user` rather than assuming
   it's in scope.
4. Prefer several small, individually-reviewable edits over one large
   rewrite — this also produces better diffs for harness's
   diff-based approval.

## Anti-pattern (do not do this)

```typescript
// Task: "refactor this function to be more readable"

// WRONG — refactor bundled with an unrequested behavior change
- function processOrder(order) {
-   if (order.total > 100) {
-     return { ...order, discount: 0.1 };
-   }
-   return order;
- }
+ function processOrder(order: Order): Order {
+   const DISCOUNT_THRESHOLD = 100;
+   const DISCOUNT_RATE = 0.15; // <-- changed from 0.1, not asked for
+   if (order.total > DISCOUNT_THRESHOLD) {
+     return { ...order, discount: DISCOUNT_RATE };
+   }
+   return order;
+ }
```
The naming/typing cleanup is fine, but silently changing the discount
rate from 0.1 to 0.15 is an unrequested behavior change hidden inside
what was asked to be a pure refactor.

## Correct pattern

```typescript
// Refactor only — behavior is provably identical
- function processOrder(order) {
-   if (order.total > 100) {
-     return { ...order, discount: 0.1 };
-   }
-   return order;
- }
+ const DISCOUNT_THRESHOLD = 100;
+ const DISCOUNT_RATE = 0.1; // unchanged — same value, just named
+ function processOrder(order: Order): Order {
+   if (order.total > DISCOUNT_THRESHOLD) {
+     return { ...order, discount: DISCOUNT_RATE };
+   }
+   return order;
+ }
```
If the discount rate genuinely needed to change too, that would be
proposed as a separate, explicitly-called-out follow-up step.

## When to use this skill

Any task described as a refactor, cleanup, or restructuring, with no
explicit behavior change requested.
