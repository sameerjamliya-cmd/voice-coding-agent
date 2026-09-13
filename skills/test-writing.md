---
name: test-writing
description: How to write tests that actually protect against regression, not just tests that pass.
always_on: false
---

# Test Writing

## Rules

1. Test observable behavior (inputs and outputs), not internal
   implementation details. A test that breaks when you refactor
   without changing behavior is testing the wrong thing.
2. One logical assertion's worth of behavior per test. If a test's name
   needs "and" to describe what it checks, split it into two tests.
3. Test names should describe the behavior being verified, not the
   mechanism (`"throws when the input list is empty"`, not
   `"test 3"` or `"handles edge case"`).
4. Avoid over-mocking. If a test mocks so much of the system that it no
   longer exercises the real logic being tested, it provides false
   confidence. Mock external boundaries (network, filesystem, time),
   not the logic under test itself.
5. Include at least one test for a realistic failure/edge case
   alongside the happy-path case — empty input, a boundary value, an
   invalid argument — not just the successful scenario.

## Anti-pattern (do not do this)

```typescript
// Tests implementation detail (which internal method was called),
// not actual behavior — breaks on any internal refactor even if
// output is unchanged
test("processOrder calls calculateTax", () => {
  const spy = jest.spyOn(module, "calculateTax");
  processOrder(order);
  expect(spy).toHaveBeenCalled();
});
```

## Correct pattern

```typescript
// Tests actual observable behavior — survives internal refactors
test("processOrder includes tax in the final total for taxable items", () => {
  const result = processOrder({ items: [{ price: 100, taxable: true }] });
  expect(result.total).toBe(108); // assuming 8% tax rate
});

test("processOrder does not add tax for non-taxable items", () => {
  const result = processOrder({ items: [{ price: 100, taxable: false }] });
  expect(result.total).toBe(100);
});
```

## When to use this skill

Any task that involves writing new tests, whether for a bug fix
(alongside `test-driven-fixing`), a new feature, or improving existing
test coverage.
