import { SQL } from './core.ts'
import { Table } from './definition/table.ts'

export function isPlainObject<T>(value: any): value is Record<string, T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

export function columnsProxy(
  target: Table | SQL.TableIdentifier | SQL.QueryIdentifier,
  getColumn: (propertyName: string) => any
): any {
  return new Proxy(target, {
    get(target: any, key) {
      if (typeof key === 'string') {
        const column = getColumn(key)
        if (column) {
          return column
        }
      }
      return target[key]
    },
  })
}
