---
name: idempotency-awareness
description: Consider whether a script, migration, or operation might run more than once, and whether that's safe.
always_on: false
---

# Idempotency Awareness

## Rules

1. For scripts, migrations, or setup operations that might be re-run
   (accidentally or intentionally), consider whether running it twice
   produces the same correct result, or causes duplicate
   data/errors/side effects.
2. Where practical, make operations idempotent — check-before-insert
   rather than blind-insert, `CREATE TABLE IF NOT EXISTS` rather than
   `CREATE TABLE`, upsert rather than insert where duplicates are
   possible.
3. If an operation genuinely cannot be made idempotent (e.g. sending a
   one-time notification), explicitly note this in
   `mark_task_complete` so the user is aware re-running it has real
   consequences, rather than leaving it as an undocumented risk.
4. This is especially relevant alongside `database-migration-safety` —
   migrations are a common case where re-runs are likely (failed
   deploys, retries) and idempotency genuinely matters.

## Anti-pattern (do not do this)

```sql
-- Fails or creates a duplicate table error if this migration
-- accidentally runs twice (e.g. after a failed deploy retry)
CREATE TABLE settings (id INT PRIMARY KEY, value TEXT);
```

## Correct pattern

```sql
CREATE TABLE IF NOT EXISTS settings (id INT PRIMARY KEY, value TEXT);
```

## When to use this skill

Any task involving scripts, migrations, or setup/initialization code
that could plausibly be executed more than once.
