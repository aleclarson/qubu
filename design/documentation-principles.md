# Documentation principles

> Internal guidance for keeping Qubu documentation durable, honest, and close to the project's actual support boundary.

## Prefer enforcement over prose

Before adding a rule to a document, ask whether a type, test, or lint rule can
enforce it. If it can, put the guarantee in the project rather than asking a
document to repeat it.

Documentation should explain intent, trade-offs, boundaries, and workflows that
the code cannot enforce on its own.

## Keep three decisions visible

The project needs durable answers to three different questions:

1. **Vision:** What problem is Qubu solving, and what does success look like?
2. **Decision framework:** Which features belong in the core, and which belong
   in user land or a dialect extension?
3. **Mental model:** What is the smallest abstraction a contributor should use
   when reasoning about the system?

These decisions can be revisited, but they should not be hidden inside a
feature guide or inferred from a collection of implementation details.

## Favor durable content

- Document intent instead of copying package scripts or source layout.
- State non-goals when they prevent users from expecting ORM or lifecycle
  behavior that Qubu does not provide.
- Keep fast-changing release notes or task lists out of the public docs.
- Give each public page one reader job and link to a canonical concept page
  instead of redefining it.

## Review for drift

When implementation and design disagree, make the disagreement explicit. Either
update the design because the change was intentional, or restore the behavior
that the design still treats as a non-negotiable.
