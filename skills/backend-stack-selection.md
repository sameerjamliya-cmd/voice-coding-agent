---
name: backend-stack-selection
description: Structured framework for recommending a backend framework, database, and hosting approach for a new project, based on actual requirements.
always_on: false
---

# Backend Stack Selection

## Rules

1. This skill assumes a language has already been chosen (either by
   the user, or via the `language-selection` skill first — if both are
   needed, resolve language first).

2. Before recommending a backend framework, database, or hosting
   approach, gather these signals via `ask_user` if not already known:
   - Expected scale (a personal project / prototype vs. something
     expecting real production traffic) — this changes how much
     "keep it simple" should dominate the recommendation.
   - Data shape and access patterns (relational data with clear
     structure vs. flexible/document-like data vs. mostly key-value)
     — this should drive the database recommendation, not popularity.
   - Real-time requirements (does this need websockets/live updates,
     or is standard request/response sufficient)?
   - Hosting/deployment constraints (self-hosted, specific cloud
     provider already in use, must be free-tier-friendly, etc.)?
   - Team/personal familiarity with specific frameworks already in the
     chosen language's ecosystem.

3. Default toward simplicity for small-scale/prototype projects —
   recommending a complex, highly-scalable architecture for a personal
   project the user described as small is a mismatch, not a strength.
   Explicitly flag when you're recommending something simple because
   the stated scale doesn't justify more.

4. State the reasoning for each individual piece (framework, database,
   hosting) separately, tied to the gathered signals — don't bundle
   "use X stack" as one unexplained package.

5. If the user's stated familiarity conflicts with what would otherwise
   be the technically best-fit choice, surface that tradeoff explicitly
   via `ask_user` rather than silently picking one side.

## Anti-pattern (do not do this)

Task: "Help me pick a backend stack for my new project."

WRONG — recommends a complex, trendy stack with no grounding:
> "Use a microservices architecture with Kubernetes, a message queue,
> and a distributed database for scalability."

No information was gathered about actual scale or need — this is
generic "impressive-sounding" advice, not a fit for an unknown project
that could just as easily be a small personal tool.

## Correct pattern

Task: "Help me pick a backend stack for my new project. It's a personal
project to track my reading list."

CORRECT — scale and data shape are already implied (small, personal,
simple structured data), so the skill uses that instead of re-asking
what's already clear, and only asks what's genuinely unknown:
> ask_user("Any hosting preference, or should I suggest something free-tier-friendly?", options: ["Free-tier friendly", "I already use a specific cloud provider", "No preference"])
> ... then recommends: "Given this is a personal project with simple,
> clearly structured data (books, read status, notes), I'd suggest a
> lightweight framework (e.g. Express or Fastify if in Node) with
> SQLite as the database — no need for a hosted database service at
> this scale — and a free-tier host suits a personal project like this
> well. A more complex distributed setup would be over-engineering for
> what's described here."

## When to use this skill

Any task asking for a backend framework, database, or hosting
recommendation for a new project. Use alongside `language-selection` if
the language hasn't been chosen yet.
