export function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
