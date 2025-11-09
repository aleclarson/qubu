import { QueryClient } from './client.ts'
import { SQL } from './core.ts'

export class QueryBuilder extends QueryClient {
  select() {}

  insertInto() {}

  update() {}

  deleteFrom() {}
}

export class QueryPromise<Out extends object> implements PromiseLike<Out[]> {
  constructor(private readonly query: SQL.Query<Out>) {}

  then<TResult1 = Out, TResult2 = never>(
    onfulfilled?:
      | ((value: Out) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): PromiseLike<TResult1 | TResult2> {}
}
