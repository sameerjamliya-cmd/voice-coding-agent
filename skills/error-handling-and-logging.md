---
name: error-handling-and-logging
description: Fail usefully — clear error messages, no silent failures, consistent with the project's existing logging pattern.
always_on: false
---

# Error Handling and Logging

## Rules

1. Error messages must state what went wrong and, where possible, what
   was expected — not a bare generic message. `"Error: undefined"` or
   `"Something went wrong"` gives the next person nothing to act on.
2. Never use an empty `catch` block that silently swallows an
   exception. At minimum, log it using the project's existing logging
   approach; in most cases, either handle it meaningfully or re-throw
   with added context.
3. Before adding a new logging statement, check how the project already
   logs (a specific logger library, a console wrapper, structured vs.
   plain-text logs) and match that pattern rather than introducing a
   different one.
4. Include relevant context in an error (which input caused it, which
   operation was being attempted) rather than just the fact that
   something failed.

## Anti-pattern (do not do this)

```typescript
try {
  await saveUser(user);
} catch (e) {
  // silently swallowed — caller has no idea this failed
}
```

## Correct pattern

```typescript
try {
  await saveUser(user);
} catch (e) {
  logger.error(`Failed to save user ${user.id}: ${e.message}`);
  throw new Error(`Could not save user ${user.id}: ${e.message}`);
}
```

## When to use this skill

Any task involving error-prone operations (I/O, network calls, parsing,
external input) or adding/modifying logging.
