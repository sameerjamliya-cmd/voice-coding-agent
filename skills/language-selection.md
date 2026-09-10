---
name: language-selection
description: Structured framework for recommending a programming language for a new project, based on the project's actual constraints.
always_on: false
---

# Language Selection

## Rules

1. Never recommend a language before gathering at least these signals,
   via `ask_user` if not already stated in the task:
   - What is the project actually for (CLI tool, web backend, data
     pipeline, mobile app, embedded/systems, script/automation)?
   - Are there team/personal familiarity constraints (only know Python,
     team already uses Go, etc.)?
   - Are there performance or concurrency requirements that rule out
     slower interpreted languages?
   - Are there ecosystem/library requirements (e.g. needs a specific ML
     library that's Python-only, needs to run in a browser so
     JS/TS is effectively required)?
   - Are there deployment/hosting constraints (e.g. must run as a
     single static binary, must run on a specific platform)?

2. If the task already answers some of these (e.g. "build a browser
   extension" implies JS/TS), don't re-ask what's already implied —
   only ask about genuinely unresolved signals.

3. When recommending, state the reasoning explicitly, tied to the
   gathered signals — never recommend a language on the basis of "it's
   generally popular" or "it's what I'd default to" alone.

4. If multiple languages are roughly equally suited given the
   constraints, say so and offer them as options via `ask_user` rather
   than picking one arbitrarily.

## Anti-pattern (do not do this)

Task: "I want to build a new project, help me pick a language."

WRONG — jumps straight to a recommendation with no requirement-gathering:
> "I'd recommend TypeScript — it's versatile and widely used."

This ignores that the task gave zero information about what the project
actually is, so the recommendation isn't grounded in anything specific.

## Correct pattern

Task: "I want to build a new project, help me pick a language."

CORRECT — gathers real signals first via `ask_user`:
> ask_user("What kind of project is this?", options: ["CLI tool", "Web backend", "Data/ML pipeline", "Something else"])
> ... (user selects "Data/ML pipeline")
> ask_user("Any team/personal language familiarity constraints?", options: ["Python preferred", "No preference", "Avoid Python"])
> ... then recommends with stated reasoning: "Given this is a data/ML
> pipeline with no constraint against Python, Python is the strongest
> fit — it has the deepest ecosystem for this (pandas, numpy, the ML
> library ecosystem generally), and there's no stated reason to avoid
> it here."

## When to use this skill

Any task where the user is asking for a language recommendation for a
new project, or where a task implies starting something from scratch
with no language yet decided.
