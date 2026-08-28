import { expect, test } from "vitest"

import {
  IntrospectionError,
  createIntrospectionDiagnostic,
  hasIntrospectionErrors,
  introspectedPhysicalIdentityPolicy,
} from "../src/introspection/index.ts"

const tableReference = {
  kind: "table" as const,
  namespace: "public",
  name: "accounts",
  catalog: {
    relation: "pg_class",
    key: "oid",
    value: 42,
  },
}

test("freezes structured diagnostics and keeps related references", () => {
  const diagnostic = createIntrospectionDiagnostic({
    severity: "warning",
    code: "unmodeled-object",
    message: "View metadata was retained outside the table model",
    path: ["deferredObjects", 0],
    physicalReference: tableReference,
    relatedReferences: [tableReference],
    remediation: "Inspect the deferred object before planning a migration",
  })

  expect(diagnostic.path).toEqual(["deferredObjects", 0])
  expect(diagnostic.physicalReference).toEqual(tableReference)
  expect(diagnostic.relatedReferences).toEqual([tableReference])
  expect(Object.isFrozen(diagnostic)).toBe(true)
  expect(Object.isFrozen(diagnostic.path)).toBe(true)
  expect(Object.isFrozen(diagnostic.physicalReference)).toBe(true)
  expect(Object.isFrozen(diagnostic.physicalReference?.catalog)).toBe(true)
  expect(Object.isFrozen(diagnostic.relatedReferences)).toBe(true)

  const error = new IntrospectionError([
    diagnostic,
    {
      severity: "error",
      code: "query-failed",
      message: "Catalog query failed",
      path: ["tables"],
    },
  ])

  expect(error.name).toBe("IntrospectionError")
  expect(error.message).toBe(
    "View metadata was retained outside the table model\nCatalog query failed",
  )
  expect(error.diagnostics).toBe(error.issues)
  expect(Object.isFrozen(error.diagnostics)).toBe(true)
  expect(Object.isFrozen(error.diagnostics[0])).toBe(true)
})

test("recognizes fatal diagnostics without treating warnings as failures", () => {
  const warnings = [
    createIntrospectionDiagnostic({
      severity: "warning",
      code: "lossy-mapping",
      message: "An optional fact was omitted",
      path: ["tables", 0],
    }),
  ]
  const errors = [
    ...warnings,
    createIntrospectionDiagnostic({
      severity: "error",
      code: "unsupported-feature",
      message: "The feature cannot be represented",
      path: ["tables", 0, "indexes", 0],
    }),
  ]

  expect(hasIntrospectionErrors(warnings)).toBe(false)
  expect(hasIntrospectionErrors(errors)).toBe(true)
})

test("records the identity precedence and physical naming policy", () => {
  expect(introspectedPhysicalIdentityPolicy).toMatchObject({
    name: "introspected-physical",
    version: 1,
    fallback: "escaped",
    precedence: ["explicit-hint", "previous-snapshot", "physical-name", "deterministic-fallback"],
  })
  expect(Object.isFrozen(introspectedPhysicalIdentityPolicy)).toBe(true)
  expect(Object.isFrozen(introspectedPhysicalIdentityPolicy.precedence)).toBe(true)
})
