export function isPlainObject<T>(value: any): value is Record<string, T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}
