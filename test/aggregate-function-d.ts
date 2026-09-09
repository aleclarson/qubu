import { aggregateFunction, withDialectCapability } from "../src/core/index.ts"
import {
  from,
  groupBy,
  select,
  type AggregateDependenciesOf,
  type CapabilitiesOf,
  type DependenciesOf,
  type HasAggregate,
  type NullabilityOf,
  type OutputOf,
  type RequiresOf,
  type VisibleDependenciesOf,
} from "../src/index.ts"
import { posts, users } from "./grouping-fixtures.ts"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

const collect = aggregateFunction<string>("app.collect")
const names = collect(users.name)
const titles = collect(posts.title)
const mixed = collect(users.name, withDialectCapability(posts.title, "custom"), "separator")
const empty = collect()

export type AggregateFacts = [
  Assert<Equal<OutputOf<typeof names>, string>>,
  Assert<Equal<HasAggregate<typeof names>, true>>,
  Assert<Equal<HasAggregate<typeof empty>, true>>,
  Assert<Equal<RequiresOf<typeof empty>, never>>,
  Assert<Equal<RequiresOf<typeof names>, RequiresOf<typeof users.name>>>,
  Assert<Equal<RequiresOf<typeof titles>, RequiresOf<typeof posts.title>>>,
  Assert<Equal<DependenciesOf<typeof names>, DependenciesOf<typeof users.name>>>,
  Assert<
    Equal<
      AggregateDependenciesOf<typeof mixed>,
      DependenciesOf<typeof users.name | typeof posts.title>
    >
  >,
  Assert<Equal<VisibleDependenciesOf<typeof mixed>, never>>,
  Assert<Equal<NullabilityOf<typeof names>, NullabilityOf<typeof users.name>>>,
  Assert<Equal<CapabilitiesOf<typeof mixed>, "custom">>,
]

select({ names }, from(users))
select(
  {
    name: users.name,
    names,
  },
  from(users),
  groupBy(users.name),
)
select(
  { names },
  // @ts-expect-error Aggregate arguments still require their source.
  from(posts),
)
select(
  {
    name: users.name,
    names,
  },
  // @ts-expect-error Selected columns must be grouped in an aggregate query.
  from(users),
)
select(
  { names },
  // @ts-expect-error An aggregate cannot be a grouping key.
  from(users),
  groupBy(names),
)
