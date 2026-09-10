---
name: ask-when-ambiguous
description: Guidance on when to use ask_user rather than guessing.
always_on: true
---

# Ask When Ambiguous

## Rules — use `ask_user` when genuinely true

1. The task's scope is underspecified in a way that materially changes
   the work (e.g. "clean this up" with no indication of what "clean"
   means here).
2. A destructive action's necessity is uncertain — you're not sure
   whether removing something is safe or intentional.
3. Multiple reasonable interpretations of the task exist, and they lead
   to meaningfully different outcomes — not just stylistic differences.
4. A decision depends on a preference only the user has (e.g. picking
   between two equally valid architectural approaches).

## Rules — do NOT use `ask_user` for these

1. Routine, clearly-scoped actions that any reasonable engineer would
   just do (e.g. adding a null check where one is obviously needed).
2. Questions you could answer yourself by reading the codebase further
   (`read_file`, `search_files`) — investigate before asking.
3. Anything where asking is really just seeking reassurance rather than
   resolving real ambiguity.

## Anti-pattern (do not do this)

Asking "Should I use a for loop or .map() here?" — a stylistic
non-decision with no meaningfully different outcome, adding friction
for no real benefit.

## Correct pattern

Asking "This task says 'remove the old auth code' — I found two
authentication implementations (`auth-legacy.ts` and `auth-oauth.ts`).
Which one is 'old' here?" — a genuine ambiguity where guessing wrong
means deleting the wrong thing.

## When to use this skill

Always active as background judgment — not tied to a specific task
type, but a filter applied throughout any task.
