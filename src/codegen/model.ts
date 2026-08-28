import type { CatalogColumn, CatalogDialect, CatalogTable } from "../introspection/types.ts"
import type {
  SnapshotColumn,
  SnapshotConstraint,
  SnapshotIndex,
  SnapshotTable,
} from "../snapshot/types.ts"
import type { CodegenApplicationType, CodegenSqlDomain } from "./types.ts"

export interface ResolvedColumn {
  readonly name: string
  readonly snapshot: SnapshotColumn
  readonly catalog: CatalogColumn
  readonly output: CodegenApplicationType
  readonly insert: CodegenApplicationType
  readonly update: CodegenApplicationType
  sqlDomain: CodegenSqlDomain
  readonly explicitSqlDomain: boolean
}

export interface ResolvedConstraint {
  readonly name: string
  readonly snapshot: SnapshotConstraint
}

export interface ResolvedIndex {
  readonly name: string
  readonly snapshot: SnapshotIndex
}

export interface ResolvedTable {
  readonly name: string
  readonly snapshot: SnapshotTable
  readonly catalog: CatalogTable
  readonly columns: readonly ResolvedColumn[]
  readonly columnsBySnapshotId: ReadonlyMap<string, ResolvedColumn>
  readonly constraints: readonly ResolvedConstraint[]
  readonly indexes: readonly ResolvedIndex[]
}

export interface ResolvedSchema {
  readonly name: string
  readonly namespace: string
  readonly dialect: CatalogDialect
  readonly tables: readonly ResolvedTable[]
  readonly tablesBySnapshotId: ReadonlyMap<string, ResolvedTable>
}
