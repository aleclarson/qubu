/** Convert an application-facing field name to a SQL-facing identifier. */
export function snakeCaseIdentifier(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

export function resolveSqlNames(
  fields: readonly {
    readonly fieldName: string
    readonly sqlName?: string
  }[],
): Readonly<Record<string, string>> {
  const sqlNames: Record<string, string> = {}
  const fieldsBySqlName = new Map<string, string>()

  for (const field of fields) {
    const sqlName = field.sqlName ?? snakeCaseIdentifier(field.fieldName)

    if (sqlName.length === 0) {
      throw new Error(`SQL name for field "${field.fieldName}" cannot be empty`)
    }

    const existingField = fieldsBySqlName.get(sqlName)

    if (existingField) {
      throw new Error(
        `Fields "${existingField}" and "${field.fieldName}" both resolve to SQL name "${sqlName}"`,
      )
    }

    fieldsBySqlName.set(sqlName, field.fieldName)
    sqlNames[field.fieldName] = sqlName
  }

  return Object.freeze(sqlNames)
}
