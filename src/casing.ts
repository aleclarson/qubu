/**
 * The function used to convert column names from camelCase to
 * snake_case.
 */
export let camelToSnake = (str: string) =>
  str.replace(/([A-Z]+)/g, '_$1').toLowerCase()

/**
 * Customize the camelToSnake function.
 */
export function setCamelToSnake(fn: (str: string) => string) {
  camelToSnake = fn
}
