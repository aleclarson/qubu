import { assertSchemaSnapshot } from "./decode.ts"
import type {
  SchemaSnapshot,
  SchemaSnapshotInput,
  SnapshotBigInt,
  SnapshotJsonValue,
  SnapshotSpecialNumber,
} from "./types.ts"

/** Error raised when a value cannot cross the canonical JSON boundary. */
export class SnapshotCanonicalError extends TypeError {
  readonly path: readonly (string | number)[]

  constructor(message: string, path: readonly (string | number)[] = []) {
    super(message)
    this.name = "SnapshotCanonicalError"
    this.path = Object.freeze([...path])
  }
}

/** Convert a JavaScript value to the explicit JSON-safe snapshot domain. */
export function toSnapshotJsonValue(
  value: unknown,
  path: readonly (string | number)[] = [],
  seen = new WeakSet<object>(),
): SnapshotJsonValue {
  if (value === null) {
    return null
  }

  switch (typeof value) {
    case "string":
    case "boolean": {
      return value
    }

    case "number": {
      if (Number.isNaN(value)) {
        return { $number: "NaN" }
      }

      if (value === Infinity) {
        return { $number: "Infinity" }
      }

      if (value === -Infinity) {
        return { $number: "-Infinity" }
      }

      return Object.is(value, -0) ? 0 : value
    }

    case "bigint": {
      return { $bigint: value.toString() } satisfies SnapshotBigInt
    }

    case "undefined":
    case "function":
    case "symbol": {
      throw new SnapshotCanonicalError(`Snapshot values cannot contain ${typeof value}`, path)
    }

    case "object": {
      break
    }

    default: {
      throw new SnapshotCanonicalError("Unsupported snapshot value", path)
    }
  }

  if (seen.has(value)) {
    throw new SnapshotCanonicalError("Snapshot values cannot be cyclic", path)
  }

  seen.add(value)

  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item, index) => toSnapshotJsonValue(item, [...path, index], seen)),
      ) as readonly SnapshotJsonValue[]
    }

    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) {
      throw new SnapshotCanonicalError(
        "Snapshot values must be plain objects, arrays, or scalar values",
        path,
      )
    }

    const result: Record<string, SnapshotJsonValue> = {}

    for (const key of Object.keys(value).sort()) {
      setOwn(
        result,
        key,
        toSnapshotJsonValue((value as Record<string, unknown>)[key], [...path, key], seen),
      )
    }

    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

/** Render a JSON-safe value with deterministic scalar and object handling. */
export function canonicalJson(value: SnapshotJsonValue): string {
  if (value === null) {
    return "null"
  }

  if (typeof value === "string") {
    return JSON.stringify(value)
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SnapshotCanonicalError("Non-finite numbers must use a tagged snapshot number")
    }

    return Object.is(value, -0) ? "0" : JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  }

  if (isSpecialNumber(value)) {
    return `{"$number":${JSON.stringify(value.$number)}}`
  }

  if (isBigInt(value)) {
    return `{"$bigint":${JSON.stringify(value.$bigint)}}`
  }

  const objectValue = value as { readonly [key: string]: SnapshotJsonValue }

  return `{${Object.keys(objectValue)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
    .join(",")}}`
}

/** Canonical JSON for a schema snapshot after fixed-order reconstruction. */
export function encodeCanonicalSnapshot(snapshot: SchemaSnapshot): string {
  return canonicalJson(assertSchemaSnapshot(snapshot) as unknown as SnapshotJsonValue)
}

/**
 * Compute a small deterministic content fingerprint for cache keys and diagnostics. It is
 * deliberately not an entity identity, signature, or migration lineage.
 */
export function schemaSnapshotFingerprint(snapshot: SchemaSnapshotInput | string): string {
  const source = encodeCanonicalSnapshot(assertSchemaSnapshot(snapshot) as SchemaSnapshot)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (let index = 0; index < source.length; index += 1) {
    const codePoint = source.codePointAt(index) ?? 0

    if (codePoint > 0xffff) {
      index += 1
    }

    const bytes = new TextEncoder().encode(String.fromCodePoint(codePoint))

    for (const byte of bytes) {
      hash ^= BigInt(byte)
      hash = (hash * prime) & mask
    }
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

function isSpecialNumber(value: object): value is SnapshotSpecialNumber {
  return (
    Object.keys(value).length === 1 &&
    "$number" in value &&
    (value as { readonly $number?: unknown }).$number !== undefined
  )
}

function isBigInt(value: object): value is SnapshotBigInt {
  return (
    Object.keys(value).length === 1 &&
    "$bigint" in value &&
    typeof (value as { readonly $bigint?: unknown }).$bigint === "string"
  )
}

// `__proto__` is a legacy setter on ordinary objects; define an own property
// so arbitrary JSON keys survive conversion.
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}
