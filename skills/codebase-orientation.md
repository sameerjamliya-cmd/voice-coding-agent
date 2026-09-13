---
name: codebase-orientation
description: Understand the relevant part of an unfamiliar codebase before making changes to it.
always_on: false
---

# Codebase Orientation

## Rules

1. Before editing a file you have not already read in this session,
   read it first — do not construct an edit based only on the file
   name or a guess at its contents.
2. Before adding new code, check for existing conventions in the
   surrounding code (naming style, error-handling pattern, whether the
   codebase uses classes vs. functions, async/await vs. promises/
   callbacks) and follow them, rather than introducing a stylistically
   different approach.
3. Before assuming a piece of functionality doesn't exist, search for
   it (`search_files`) — don't reimplement something that's already
   present elsewhere in the project under a different name than
   expected.
4. Check whether tests already exist for the code being changed
   (`search_files` for the relevant test file) before writing new
   tests — extend existing test files/patterns rather than creating a
   parallel, inconsistent test structure.

## Anti-pattern (do not do this)

Writing a new utility function for formatting currency without first
checking whether the project already has one (e.g. in a `utils/`
directory), resulting in two slightly different implementations of the
same thing existing side by side.

## Correct pattern

Running `search_files("formatCurrency")` or equivalent before writing
new formatting logic, finding an existing implementation in
`src/utils/format.ts`, and using or extending that instead of
duplicating it.

## When to use this skill

Any task in a codebase the agent has not already built up context on
during the current session — effectively, most tasks at their start.
