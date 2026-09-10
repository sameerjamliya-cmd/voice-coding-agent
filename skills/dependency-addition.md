---
name: dependency-addition
description: Careful procedure for adding a new package or library.
always_on: false
---

# Dependency Addition

## Rules

1. Before proposing a new dependency, check whether the project's
   existing dependencies (via `read_package_manifest`) or the language's
   standard library already solve the need.
2. If a new dependency is genuinely justified, prefer smaller,
   well-scoped, actively maintained packages over large,
   do-everything, or seemingly unmaintained ones.
3. State the specific reason for the chosen package in your
   `mark_task_complete` summary — not just that a package was added,
   but why this one and why it was necessary at all.
4. This skill governs judgment only — actually installing a package
   (`npm install` via `run_command`) still goes through harness's normal
   approval gate and denylist checks; this skill doesn't change that.

## Anti-pattern (do not do this)

```
// Task: "format this date as YYYY-MM-DD"

// WRONG — reaches for a large dependency for a one-line need
run_command("npm install moment")

const formatted = moment(date).format("YYYY-MM-DD");
```
`moment` is a large, now-legacy-maintenance-mode library, pulled in for
something the standard library already handles.

## Correct pattern

```typescript
// No new dependency needed — native Date/Intl handles this
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
}
```

## When to use this skill

Any task that might plausibly involve adding a new package — evaluate
this before proposing `run_command` with an install, not after.
