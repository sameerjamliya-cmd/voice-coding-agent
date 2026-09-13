---
name: library-research
description: Verify current library/API behavior via docs search before relying on training-data knowledge, especially for fast-moving libraries.
always_on: false
---

# Library Research

## Rules

1. Before writing code that calls a library/framework API you have not
   already confirmed via `read_file`/`search_files` in this project
   (i.e. you're relying on general knowledge, not something you can see
   in this codebase), consider whether that library is fast-moving or
   frequently updated. If so, use the docs-search MCP tool to check
   current usage before writing the call.
2. This applies especially to: any library whose training-data-era API
   might plausibly have changed (major version bumps, deprecated
   methods, renamed parameters) — not to stable, rarely-changing
   standard library functions where verification adds little value.
3. If docs-search returns nothing relevant or the server isn't
   available, say so explicitly rather than silently falling back to
   unverified assumptions without flagging that you did so.
4. Do not use this as a reason to research every trivial call — this is
   for genuine uncertainty about current API shape, not a blanket
   requirement to search before every library usage.

## Anti-pattern (do not do this)

Writing a call to a library method based purely on remembered training
knowledge, when the library is known to have had breaking changes since
that knowledge was current, without checking:

```typescript
// Assumed from memory, not verified — library had a major version
// bump that changed this exact method's signature
const result = someLibrary.oldMethodName(arg1, arg2);
```

## Correct pattern

```
// Task uses `someLibrary`, a fast-moving library.
// Before writing the call:
docs_search("someLibrary current API for X")
// → docs confirm the method was renamed and now takes a single options object

const result = someLibrary.newMethodName({ arg1, arg2 });
```

## When to use this skill

Any task involving an unfamiliar or fast-moving external library where
the correct current API isn't already visible in the project's own code
or already confirmed within this session.
