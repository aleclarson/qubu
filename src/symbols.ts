// Tokens
export const PgType = Symbol.for('pg.type')
export const PgIdent = Symbol.for('pg.ident')
export const PgParam = Symbol.for('pg.param')
export const PgSequence = Symbol.for('pg.sequence')
export const PgSyntax = Symbol.for('pg.syntax')
export const PgClause = Symbol.for('pg.clause')

// Column metadata
export const ColumnConstraints = Symbol.for('column.constraints')
export const ColumnType = Symbol.for('column.type')
export const ColumnStandardSchema = Symbol.for('column.standardSchema')
export const ColumnName = Symbol.for('column.name')
export const ColumnNullable = Symbol.for('column.nullable')
export const ColumnTable = Symbol.for('column.table')

// Table metadata
export const TableColumns = Symbol.for('table.columns')
export const TableName = Symbol.for('table.name')
export const TableSchema = Symbol.for('table.schema')

// SQL metadata
export const SQLDecoder = Symbol.for('sql.decoder')
export const SQLAlias = Symbol.for('sql.alias')
export const SQLTokens = Symbol.for('sql.tokens')
export const SQLFields = Symbol.for('sql.fields')

// Identifier metadata
export const IdentName = Symbol.for('ident.name')
export const IdentNamespace = Symbol.for('ident.namespace')
export const IdentColumn = Symbol.for('ident.column')
