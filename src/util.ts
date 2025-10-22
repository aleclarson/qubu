export function isPlainObject<T>(value: any): value is Record<string, T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

export function columnsProxy(
  target: any,
  getColumn: (propertyName: string) => any
): any {
  return new Proxy(target, {
    get(_, key) {
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
