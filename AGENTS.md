- Qubu is pre-alpha. Avoid backwards-compatibility work; prefer hard breaks with no legacy shims.

- When asked to setup a test file:
  - Don't worry about implementing the tests. Mark them with `.skip` for now.
- When writing tests:
  - Prefer `test()` over `it()`.
  - Don't start test names with "should" or similar; just name the feature being tested.
  - Type-checking test files should use "-d.ts" suffix (note the hyphen).
