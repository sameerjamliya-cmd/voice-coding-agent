---
name: incremental-changes
description: Make one logically complete change per tool call, so snapshots and undo remain meaningful and precise.
always_on: true
---

# Incremental Changes

## Rules

1. Each `edit_file`/`write_file` call should represent one logically
   complete, independently-reasonable-about change — not a bundle of
   several unrelated edits combined into a single call because both
   happened to be in the same file.
2. If a task naturally involves several distinct changes (e.g. fixing
   one bug AND renaming a variable AND adding a comment), make them as
   separate tool calls, in a sensible order, rather than one large
   edit combining all three.
3. This directly determines how useful `agent undo` is in practice — a
   snapshot after a bundled, multi-purpose edit can only be undone as a
   whole; a snapshot after one focused change can be undone precisely
   without losing unrelated, still-good work.
4. This does not mean making changes artificially small for their own
   sake — a single coherent change (e.g. renaming one variable
   everywhere it's used within one file) is still one logical unit,
   even if it touches multiple lines.

## Anti-pattern (do not do this)

Combining a bug fix, an unrelated variable rename, and a new comment
into a single `edit_file` call. If the bug fix later needs to be undone
via `agent undo`, the rename and comment are lost too, even though
they were unrelated and fine.

## Correct pattern

Three separate `edit_file` calls: one for the bug fix, one for the
rename, one for the comment — each independently reviewable at
approval time, and each independently undoable afterward without
affecting the other two.

## When to use this skill

Always active as background working style — not tied to a specific
task type, applies to how any multi-part task gets broken into tool
calls.
