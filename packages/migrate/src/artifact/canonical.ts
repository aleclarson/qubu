import type { SnapshotJsonValue } from "qubu/snapshot"

/** Canonical JSON and byte encoding used by migration integrity hashes. */
export const canonicalizationFormat = "qubu-canonical-json" as const
export const canonicalizationVersion = 1 as const
export const digestAlgorithm = "sha-256" as const
export const digestAlgorithmVersion = 1 as const
export const canonicalizationDescriptor = Object.freeze({
  format: canonicalizationFormat,
  version: canonicalizationVersion,
})
export const digestAlgorithmDescriptor = Object.freeze({
  algorithm: digestAlgorithm,
  version: digestAlgorithmVersion,
})

export type DigestDomain =
  | "artifact"
  | "baseline"
  | "migration-plan"
  | "migration-program"
  | "schema-snapshot"

export type Sha256Digest = `sha256:${string}`

const encoder = new TextEncoder()
const domainPrefix = "qubu:migrate:v1:"

/** Encode a JSON value with sorted object keys, no insignificant whitespace, UTF-8, and LF EOF. */
export function encodeCanonical(value: SnapshotJsonValue): Uint8Array {
  return encoder.encode(`${stringifyCanonical(value)}\n`)
}

export function canonicalText(value: SnapshotJsonValue): string {
  return `${stringifyCanonical(value)}\n`
}

/** Hash canonical source values with a versioned, NUL-delimited domain prefix. */
export async function digestCanonical(
  domain: DigestDomain,
  value: SnapshotJsonValue,
): Promise<Sha256Digest> {
  const source = encodeCanonical(value)
  const prefix = encoder.encode(`${domainPrefix}${domain}\0`)
  const bytes = new Uint8Array(prefix.length + source.length)

  bytes.set(prefix)
  bytes.set(source, prefix.length)
  const hash = await crypto.subtle.digest("SHA-256", bytes)

  return `sha256:${hex(new Uint8Array(hash))}`
}

export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}

function stringifyCanonical(value: SnapshotJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON numbers must be finite")
    }

    return Object.is(value, -0) ? "0" : JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stringifyCanonical).join(",")}]`
  }

  const object = value as Readonly<Record<string, SnapshotJsonValue>>

  return `{${Object.keys(object)
    .sort(compareUnicode)
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(object[key]!)}`)
    .join(",")}}`
}

function compareUnicode(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function hex(bytes: Uint8Array): string {
  let value = ""

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0")
  }

  return value
}
