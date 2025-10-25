import { SQL } from '../core.ts'
import { unsafe } from '../tokens.ts'

export function caseWhen<T extends SQL.Part>(condition: SQL.Part, result: T) {
  return new CaseWhen<SQL.InferOutput<T>>(condition, result)
}

export class CaseWhen<Out = any> extends SQL.Expression<Out> {
  constructor(condition: SQL.Part, result: SQL.Part) {
    super(['case'])
    this.when(condition, result)
  }

  when<const T extends SQL.Part>(condition: SQL.Part, result: T) {
    return this.$append([
      unsafe('when'),
      condition,
      unsafe('then'),
      result,
    ]) as CaseWhen<Out | SQL.InferOutput<T>>
  }

  else<const T extends SQL.Part>(result: T) {
    return this.$append([
      unsafe('else'),
      result,
      unsafe('end'),
    ]) as SQL.Expression<Out | SQL.InferOutput<T>>
  }

  /**
   * End the `case` expression without an `else` clause. This results
   * in `null` if none of the conditions are met.
   */
  end() {
    return this.$append([unsafe('end')]) as SQL.Expression<Out | null>
  }
}
