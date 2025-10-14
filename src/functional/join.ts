import { InferSQL, SQL, SQLParameter } from '../core.ts'

export function innerJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'inner', 'join', tableRef, 'on', condition)
}

export function leftJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'left', 'join', tableRef, 'on', condition)
}

export function rightJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'right', 'join', tableRef, 'on', condition)
}

export function fullJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'full', 'join', tableRef, 'on', condition)
}

export function crossJoin(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return InferSQL(this.selection, 'cross', 'join', tableRef)
}

export function naturalInnerJoin(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return InferSQL(this.selection, 'natural', 'inner', 'join', tableRef)
}

export function naturalLeftJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(
    this.selection,
    'natural',
    'left',
    'join',
    tableRef,
    'on',
    condition
  )
}

export function naturalRightJoin(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(
    this.selection,
    'natural',
    'right',
    'join',
    tableRef,
    'on',
    condition
  )
}

export function leftJoinLateral(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'left', 'join', tableRef, 'on', condition)
}

export function innerJoinLateral(
  tableRef: Exclude<SQL.Part, SQLParameter>,
  condition: SQL
) {
  return InferSQL(this.selection, 'inner', 'join', tableRef, 'on', condition)
}

export function crossJoinLateral(tableRef: Exclude<SQL.Part, SQLParameter>) {
  return InferSQL(this.selection, 'cross', 'join', tableRef)
}

export function union(other: SQL) {
  return InferSQL(this.selection, 'union', other)
}
export function unionAll(other: SQL) {
  return InferSQL(this.selection, 'union', 'all', other)
}

export function intersect(other: SQL) {
  return InferSQL(this.selection, 'intersect', other)
}
export function intersectAll(other: SQL) {
  return InferSQL(this.selection, 'intersect', 'all', other)
}

export function except(other: SQL) {
  return InferSQL(this.selection, 'except', other)
}
export function exceptAll(other: SQL) {
  return InferSQL(this.selection, 'except', 'all', other)
}
