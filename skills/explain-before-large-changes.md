---
name: explain-before-large-changes
description: When and how to state a plan before executing a large or risky change.
always_on: false
---

# Explain Before Large Changes

## Rules

1. Before making a change that touches more than ~3 files, deletes a
   substantial block of code, or alters a function/module's public
   interface, state your intended approach clearly (in your reasoning,
   or via `ask_user` if genuinely uncertain) before executing it.
2. The explanation should state: what will change, why, and what could
   break as a result — not just "I'm going to refactor X."
3. This directly feeds harness's diff-based approval step — a clearly
   stated intent makes the resulting diff faster and more accurate to
   review, since the reviewer knows what to expect before seeing it.

## Anti-pattern (do not do this)

Silently making a 6-file change to rename a widely-used function, with
no stated plan, surfacing only as a single large diff at approval time
with no context for why each file needed to change.

## Correct pattern

Stating up front: "This rename affects the function's usage in 6
files. I'll rename the definition first, then update each call site.
No behavior changes — purely a rename." — then proceeding, so the
approval-time diffs are reviewed with that context already established.

## When to use this skill

Any task where the scope of the change is large relative to the size
of a typical single edit, or where a public interface is being altered.
