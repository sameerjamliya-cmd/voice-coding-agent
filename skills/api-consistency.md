---
name: api-consistency
description: Keep new functions, endpoints, or interfaces consistent with how the rest of the codebase already does similar things.
always_on: false
---

# API Consistency

## Rules

1. Before adding a new function/endpoint/class, look at how similar,
   existing ones in the codebase are structured (parameter order,
   naming pattern, return type shape, error-handling approach) and
   match that pattern rather than introducing a new one.
2. If the codebase consistently uses one pattern for a category of
   thing (e.g. all API handlers return `{ data, error }` shaped
   results), a new addition should follow that same shape, not throw
   raw exceptions or return a differently-shaped result.
3. If there genuinely is no existing precedent to follow (this is the
   first of its kind in the codebase), pick a reasonable pattern and
   note in `mark_task_complete` that this establishes a new pattern,
   so the user is aware it's a precedent decision, not a followed one.

## Anti-pattern (do not do this)

```typescript
// Existing handlers in this file all return { data, error } shaped results:
function getUser(id) { /* ... returns { data, error } ... */ }
function getOrder(id) { /* ... returns { data, error } ... */ }

// WRONG — new addition throws instead of matching the established pattern
function getInvoice(id) {
  const invoice = db.find(id);
  if (!invoice) throw new Error("not found"); // inconsistent with the rest of the file
  return invoice;
}
```

## Correct pattern

```typescript
function getInvoice(id): { data: Invoice | null; error: string | null } {
  const invoice = db.find(id);
  if (!invoice) return { data: null, error: "not found" };
  return { data: invoice, error: null };
}
```

## When to use this skill

Any task adding a new function, endpoint, class, or module to an
existing codebase with established patterns to follow.
