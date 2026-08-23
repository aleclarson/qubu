- Qubu is pre-alpha. Avoid backwards-compatibility work; prefer hard breaks with no legacy shims.
- The adapter × environment combo-scenario library belongs in a separate
  repository mounted here as a Git submodule. Edit the library through its
  submodule checkout in this workspace; do not copy its files into the Qubu
  repository.
- Read [.agents/rules/TESTING.md](.agents/rules/TESTING.md) before adding or changing tests. It defines the test-layer boundaries and the scope of live dialect tests.
