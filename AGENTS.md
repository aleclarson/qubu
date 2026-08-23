- Qubu is pre-alpha. Avoid backwards-compatibility work; prefer hard breaks with no legacy shims.
- The adapter × environment combo-scenario library belongs in a separate
  repository mounted here as a Git submodule. A combo pairs a Qubu adapter or
  driver with an execution environment such as Node.js, Bun, Deno, Cloudflare
  Workers, or a browser. Edit the library through its submodule checkout in
  this workspace; do not copy its files into the Qubu repository. Scenarios may
  be illustrative rather than executable. Label each scenario `verified` or
  `experimental`; `verified` scenarios require CI coverage, while
  `experimental` scenarios do not.
- Read [.agents/rules/TESTING.md](.agents/rules/TESTING.md) before adding or changing tests. It defines the test-layer boundaries and the scope of live dialect tests.
