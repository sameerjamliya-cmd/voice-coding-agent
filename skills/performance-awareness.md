---
name: performance-awareness
description: Avoid obviously inefficient patterns when a straightforward better alternative exists, without over-optimizing prematurely.
always_on: false
---

# Performance Awareness

## Rules

1. Avoid accidental quadratic behavior when a linear approach is
   straightforward — e.g. calling `.includes()` on an array inside a
   loop when a `Set` would give constant-time lookups.
2. Avoid making a network/database call inside a loop when a single
   batch call achieves the same result (the classic N+1 query
   problem).
3. Do not prematurely optimize at the cost of clarity for code paths
   with no realistic performance concern (e.g. a config-loading
   function that runs once at startup does not need micro-optimization).
   This skill is about avoiding obviously wasteful patterns, not
   chasing marginal gains everywhere.
4. If a performance tradeoff is genuinely ambiguous (clarity vs. speed,
   with no obviously-correct answer), default to the clearer version
   unless the task specifically calls out performance as a concern.

## Anti-pattern (do not do this)

```typescript
// N+1 query — one DB call per user, inside a loop
async function getUsersWithOrders(userIds: string[]) {
  const results = [];
  for (const id of userIds) {
    const orders = await db.query("SELECT * FROM orders WHERE user_id = ?", [id]);
    results.push(orders);
  }
  return results;
}
```

## Correct pattern

```typescript
// Single batch query instead of one per user
async function getUsersWithOrders(userIds: string[]) {
  const orders = await db.query(
    "SELECT * FROM orders WHERE user_id IN (?)",
    [userIds]
  );
  return groupOrdersByUserId(orders, userIds);
}
```

## When to use this skill

Any task involving loops over external calls (database, network, file
I/O), or operations over collections where the size could plausibly
grow large.
