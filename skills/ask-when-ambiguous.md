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

## Investigating first does not mean you may guess if it comes up empty

Rule 2 above says to investigate before asking — but investigating and
then picking an option anyway, once that investigation found no real
signal either way, is not "resolving the ambiguity," it's guessing
with extra steps. If you've read the code, checked git history/blame,
searched for usages, and you *still* have no concrete basis for
preferring one option over the other, that absence of a signal is
itself the answer to "should I ask" — you must call `ask_user` at that
point, not fall back to a coin-flip choice (e.g. picking the
alphabetically-first file, or the one that "looks newer" with no
actual evidence). This applies with extra force when the action is
destructive or hard to reverse (deleting a file, removing a function
still referenced elsewhere) — the cost of investigation coming up
empty and guessing wrong is exactly what this skill exists to prevent.

## Anti-pattern (do not do this)

Asking "Should I use a for loop or .map() here?" — a stylistic
non-decision with no meaningfully different outcome, adding friction
for no real benefit.

**A second anti-pattern, specifically about the "investigated, still
guessed" failure above:** two files, `config-parser.js` and
`parse-config.js`, both exporting an equivalent `parseConfig` function
and each imported from a different, equally-plausible-looking call
site. Task: "remove the old duplicate, we don't need two." You check
`git blame` on both — same commit, no distinguishing timestamp. You
search for other usages — both are referenced, symmetrically. There is
no signal indicating which one is "old." Deleting one anyway based on
a guess (file name, alphabetical order, which one "reads cleaner") is
exactly the anti-pattern: you correctly investigated per rule 2, found
nothing, and then guessed on a destructive, hard-to-reverse action
instead of asking. The correct move once investigation comes up empty
is `ask_user`, not a confident-sounding commit message rationalizing
whichever one you picked.

## Correct pattern

Asking "This task says 'remove the old auth code' — I found two
authentication implementations (`auth-legacy.ts` and `auth-oauth.ts`).
Which one is 'old' here?" — a genuine ambiguity where guessing wrong
means deleting the wrong thing.

## When to use this skill

Always active as background judgment — not tied to a specific task
type, but a filter applied throughout any task.
