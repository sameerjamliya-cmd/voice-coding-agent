---
name: backward-compatibility
description: Avoid silently breaking other callers when modifying an existing public function, API, or exported type.
always_on: false
---

# Backward Compatibility

## Rules

1. Before changing the signature, return type, or behavior of an
   existing exported function/class/type, search for its usages
   (`search_files`) to understand who else depends on it.
2. If other callers exist and the task doesn't explicitly ask for a
   breaking change, prefer an approach that preserves the existing
   contract — e.g. adding an optional new parameter rather than
   changing an existing required one, or adding a new function rather
   than changing an existing one's behavior.
3. If a breaking change is genuinely necessary, update all existing
   call sites as part of the same task, and state clearly in
   `mark_task_complete` that this was a breaking change and why it was
   required.
4. This applies most to code with multiple callers within the project;
   a private, single-use helper function has no compatibility concern.

## Anti-pattern (do not do this)

Changing `formatDate(date)` to `formatDate(date, timezone)` as a
required second parameter, without checking or updating the three other
places in the codebase that already call `formatDate(date)` with one
argument — silently breaking them.

## Correct pattern

Changing it to `formatDate(date, timezone?: string)` with an optional
parameter and a sensible default, preserving every existing call site's
behavior, or explicitly finding and updating all three existing call
sites if a required parameter is genuinely necessary.

## When to use this skill

Any task modifying an existing exported/public function, class, or
type that other code in the project might already depend on.
