- Qubu is pre-alpha. Avoid backwards-compatibility work; prefer hard breaks with no legacy shims.
- The adapter × environment combo-scenario library belongs in a separate
  repository mounted here as a Git submodule. Edit the library through its
  submodule checkout in this workspace; do not copy its files into the Qubu
  repository. The submodule may import or link directly to this Qubu checkout
  and does not need to work as a standalone repository.
- A combo pairs a database-client integration that implements Qubu's
  driver-facing boundaries with an execution environment such as Node.js, Bun,
  Deno, Cloudflare Workers, or a browser. Track the complete candidate matrix;
  each pair must be `verified`, `experimental`, `incompatible`, or
  `not-yet-written`.
- Authored scenarios may be illustrative rather than standalone executable
  projects. A shared runner may import the scenario modules. `verified`
  scenarios require CI coverage, while `experimental` scenarios do not.
- Read [.agents/rules/TESTING.md](.agents/rules/TESTING.md) before adding or changing tests. It defines the test-layer boundaries and the scope of live dialect tests.
