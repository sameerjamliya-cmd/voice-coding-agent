---
name: database-migration-safety
description: Write schema migrations safely, assuming they may run against real data.
always_on: false
---

# Database Migration Safety

## Rules

1. Never write a migration that assumes the database is empty or only
   contains test data, unless explicitly told this is a fresh/dev-only
   database.
2. Prefer additive, backward-compatible migration steps over
   destructive single-step changes — e.g. add a new column, backfill
   it, then remove the old column in a later step, rather than
   renaming a column in place in a way that breaks anything still
   reading the old name during a deploy window.
3. Any migration that drops a column, drops a table, or otherwise
   destroys data must be flagged explicitly via `ask_user` before being
   applied, regardless of harness's general approval-gate behavior for
   `run_command` — this is a distinct, high-consequence category worth
   surfacing clearly rather than relying on the generic gate alone.
4. Write migrations to be re-runnable/idempotent where practical (see
   `idempotency-awareness`), so a partial failure doesn't leave the
   database in an ambiguous state.

## Anti-pattern (do not do this)

```sql
-- Single destructive step — any code still expecting the old column
-- name breaks immediately, and the data transformation isn't reversible
ALTER TABLE users RENAME COLUMN full_name TO name;
```

## Correct pattern

```sql
-- Step 1 (this migration): add the new column, backfill from the old one
ALTER TABLE users ADD COLUMN name VARCHAR(255);
UPDATE users SET name = full_name;

-- Step 2 (a later migration, after all code is updated to use `name`):
ALTER TABLE users DROP COLUMN full_name;
```

## When to use this skill

Any task involving a database schema change or migration file.
