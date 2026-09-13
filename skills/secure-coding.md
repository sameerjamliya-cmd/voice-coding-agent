---
name: secure-coding
description: Avoid common code-level security issues when writing or editing code that handles external input.
always_on: false
---

# Secure Coding

## Rules

1. Never build a database query by concatenating raw user input into a
   query string. Use parameterized queries / prepared statements
   always.
2. Never hardcode secrets, API keys, or credentials directly in source
   code — reference them via environment variables or a secrets
   manager the project already uses.
3. Validate and sanitize any input that crosses a trust boundary (user
   input, external API responses, file uploads) before using it —
   don't assume external data is well-formed or safe.
4. Avoid unsafe deserialization of untrusted data (e.g. deserializing
   arbitrary objects from user-controlled input without validation).
5. When writing code that renders user-controlled content (e.g. in a
   web response), ensure it's properly escaped to avoid injection
   (XSS-style issues), unless the templating system already handles
   this automatically.

## Anti-pattern (do not do this)

```typescript
// SQL injection risk — raw string concatenation with user input
function getUser(userId: string) {
  return db.query(`SELECT * FROM users WHERE id = '${userId}'`);
}
```

## Correct pattern

```typescript
// Parameterized query — user input is never part of the query string itself
function getUser(userId: string) {
  return db.query("SELECT * FROM users WHERE id = ?", [userId]);
}
```

## When to use this skill

Any task involving code that handles external/user input, database
queries, authentication, file uploads, or rendering dynamic content.
