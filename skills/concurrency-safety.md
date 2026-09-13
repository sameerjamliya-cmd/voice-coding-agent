---
name: concurrency-safety
description: Avoid unhandled promise rejections and race conditions in async code.
always_on: false
---

# Concurrency Safety

## Rules

1. Every promise must be either `await`ed, returned, or explicitly
   handled with `.catch()` — never left as an unhandled floating
   promise ("fire and forget" without an explicit reason and error
   handling).
2. When multiple async operations mutate shared state, make sure the
   ordering/coordination is intentional — don't assume operations
   complete in the order they were started unless you've explicitly
   awaited each one in sequence or used a coordination primitive
   (`Promise.all`, a lock, a queue) appropriate to the need.
3. When operations are independent (don't depend on each other's
   results), prefer running them concurrently (`Promise.all`) over
   sequentially awaiting each one, for both correctness clarity and
   performance (ties to `performance-awareness`).
4. Be explicit about whether concurrent operations should all succeed
   together or can partially fail — `Promise.all` fails entirely if one
   rejects; `Promise.allSettled` allows partial success. Pick
   deliberately, not by default.

## Anti-pattern (do not do this)

```typescript
// Floating promise — no await, no catch; failure is silently lost
function saveAndNotify(user: User) {
  saveUser(user); // not awaited
  notifyUser(user);
}
```

## Correct pattern

```typescript
async function saveAndNotify(user: User) {
  await saveUser(user);
  await notifyUser(user);
}
// Or, if independent and both should succeed together:
async function saveAndNotify(user: User) {
  await Promise.all([saveUser(user), notifyUser(user)]);
}
```

## When to use this skill

Any task involving async/await code, promises, or operations that could
run concurrently.
