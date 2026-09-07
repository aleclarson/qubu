# Artifacts and approval policy

> Review migration files and approve the exact operations they will run.

An artifact is a versioned migration file. Qubu supports two kinds:

- An **executable migration** contains a reviewed plan and the program to run.
- A **verified baseline** records the observed schema as a starting point. It
  does not claim that historical SQL ran through Qubu.

## Published formats

These format versions are independent of npm package semver:

| Value                       | Current version | Meaning                                  |
| --------------------------- | --------------: | ---------------------------------------- |
| `qubu-executable-migration` |               1 | Executable artifact envelope             |
| `qubu-verified-baseline`    |               1 | Non-executable verified starting point   |
| `qubu-migration-program`    |               1 | Ordered executable phases and statements |
| `qubu-migration-plan`       |               2 | Dialect-neutral reviewed plan            |
| `qubu-canonical-json`       |               1 | Canonical JSON byte encoding             |
| `sha-256`                   |               1 | Operational digest algorithm contract    |
| `qubu-migration-journal`    |               1 | Logical journal format                   |

Strict decoders reject unknown keys, malformed values, non-canonical encoded
text, unsupported versions, and digest mismatches. There is no compatibility
decoder for provisional application formats.

### Executable artifact schema

An executable artifact records:

- `id`, zero-based `sequence`, and `parentArtifactDigest` lineage;
- canonicalization and digest descriptors, dialect, and optional minimum server
  version or required capability constraints;
- the plan plus `planDigest`;
- renderer identity, the program, and `programDigest`;
- before/after snapshot descriptors, each with a strong digest and either an
  embedded snapshot or a reference;
- operation-scoped approvals and custom-program provenance;
- artifact provenance and `artifactDigest`.

The executor runs the program stored in the artifact. The SQL preview from
`emitMigrationPlan(...).sql` is not an executable artifact.

Each phase declares:

- Its position and dependencies.
- Transaction and lock requirements.
- Preconditions and postconditions.
- Ordered statements.

Each statement declares its operation ID, dependencies, SQL, and tagged parameters.

### Baseline artifact schema

A baseline records:

- `id`, sequence, and parent lineage.
- Encoding descriptors.
- Dialect and optional constraints.
- One verified snapshot descriptor and `verifiedAt`.
- Provenance and optional operator metadata.
- `artifactDigest`.

It has no migration plan, program, or SQL digest.

Artifact IDs are stable identities, not repository order. Sequence and parent
digest establish the linear chain. Renumbering therefore changes lineage and
the artifact digest.

## Canonical bytes and digest domains

`encodeCanonical()` produces a repeatable byte representation:

- Sort object keys by Unicode code-point order.
- Preserve array order.
- Emit compact UTF-8 JSON.
- Normalize `-0` to `0` and reject non-finite numbers.
- End the file with one line feed.

`digestCanonical()` prefixes those bytes with the UTF-8 bytes for:

```text
qubu:migrate:v1:<domain>\0
```

The digest identifies its purpose through one of five domains:

- `artifact`.
- `baseline`.
- `migration-plan`.
- `migration-program`.
- `schema-snapshot`.

The prefix ensures that identical JSON used for different purposes gets
different digests.

Operational digests have the form `sha256:` plus 64 lowercase hexadecimal
digits and are recomputed while sealing or decoding.

### Fingerprints and integrity digests

Snapshot and plan `fingerprint` APIs are deterministic FNV-1a64 change
detectors. They remain useful for caches and fixture assertions, but they are
not cryptographic integrity evidence and are never valid journal heads,
artifact parents, or substitutes for a SHA-256 field.

## Exact approval policy

Preview planning may retain unresolved safety findings. Sealing is stricter:

| Operation state                        | Sealing rule                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Safe and supported                     | No approval required                                                              |
| Review-required, destructive, or lossy | Exact `operationId` approval with a non-empty reason                              |
| Unknown or unsupported                 | Exact custom-program substitution and `custom-program` approval                   |
| Explicit custom SQL                    | Always requires exact review and a reason                                         |
| Skipped operation                      | Recompute the target snapshot before sealing; never preserve a false after-digest |

An approval also records the operation's safety and the exact sorted finding
codes. It may record `approvedBy` and `approvedAt`. A mismatched operation ID,
safety classification, finding set, or decision fails compilation. A broad
"allow unsafe" option on the preview DDL emitter is not an artifact-sealing
approval.

Custom programs replace one exact operation. They must declare transaction and
lock requirements, statements, tagged parameters, and any pre/postconditions,
plus source and reason provenance. Qubu does not split arbitrary SQL, infer its
effects, or approve it automatically.

## Version and golden-fixture maintenance

Treat canonical bytes and the meaning of every published field as release
contracts. When changing an encoder, tag, ordering rule, parameter encoding,
renderer meaning, or schema:

1. Keep golden values for every already-published artifact, baseline, program,
   plan, snapshot, canonicalization, and digest version.
2. Verify the same canonical bytes and SHA-256 results in Node.js, Bun, and a
   worker-compatible Web Crypto runtime.
3. If encoded bytes or semantics change, introduce a new explicit format,
   canonicalization, digest, plan, program, renderer, or artifact version as
   appropriate. Do not silently update a version 1 fixture.
4. Keep old fixtures as decode/verification evidence for supported published
   versions; add a new fixture for the new version.
5. Run artifact tamper/non-canonical tests and packed-package checks before
   release.

The current canonical SHA-256 vectors live with
`packages/migrate/test/artifact.test.ts`; changes to them require the same
intentional version decision as file-based golden fixtures.
