import { expectTypeOf } from "vitest"

import {
  bigint,
  binary,
  boolean,
  column,
  date,
  integer,
  json,
  nativeColumn,
  nativeStorage,
  numeric,
  text,
  timestamp,
  uuid,
} from "../src/index.ts"
import type {
  ColumnStorageDeclarationOf,
  ColumnStorageDialectOf,
  ColumnStorageKindOf,
  ColumnStorageOf,
  ColumnStorageTypeOf,
  NativeColumnStorage,
  PortableColumnStorage,
} from "../src/index.ts"

const definitions = {
  integer: integer(),
  numeric: numeric(),
  text: text(),
  boolean: boolean(),
  date: date(),
  timestamp: timestamp(),
  dateTime: timestamp(),
  uuid: uuid(),
  json: json<{ ok: boolean }>(),
  bigint: bigint(),
  binary: binary(),
}

expectTypeOf<ColumnStorageOf<typeof definitions.integer>>().toEqualTypeOf<
  PortableColumnStorage<"integer">
>()
expectTypeOf<ColumnStorageOf<typeof definitions.numeric>>().toEqualTypeOf<
  PortableColumnStorage<"numeric">
>()
expectTypeOf<ColumnStorageOf<typeof definitions.text>>().toEqualTypeOf<
  PortableColumnStorage<"text">
>()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.boolean>>().toEqualTypeOf<"boolean">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.date>>().toEqualTypeOf<"date">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.timestamp>>().toEqualTypeOf<"timestamp">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.dateTime>>().toEqualTypeOf<"timestamp">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.uuid>>().toEqualTypeOf<"uuid">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.json>>().toEqualTypeOf<"json">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.bigint>>().toEqualTypeOf<"bigint">()
expectTypeOf<ColumnStorageTypeOf<typeof definitions.binary>>().toEqualTypeOf<"binary">()

const custom = nativeColumn(nativeStorage("postgresql", 'citext COLLATE "C"'), {
  nullable: true,
})

expectTypeOf<ColumnStorageOf<typeof custom>>().toEqualTypeOf<
  NativeColumnStorage<"postgresql", 'citext COLLATE "C"'>
>()
expectTypeOf<ColumnStorageDialectOf<typeof custom>>().toEqualTypeOf<"postgresql">()
expectTypeOf<ColumnStorageDeclarationOf<typeof custom>>().toEqualTypeOf<'citext COLLATE "C"'>()
expectTypeOf<ColumnStorageKindOf<typeof custom>>().toEqualTypeOf<"native">()

const customFromArguments = nativeColumn("mysql", "VARCHAR(255)")

expectTypeOf<ColumnStorageDialectOf<typeof customFromArguments>>().toEqualTypeOf<"mysql">()
expectTypeOf<
  ColumnStorageDeclarationOf<typeof customFromArguments>
>().toEqualTypeOf<"VARCHAR(255)">()

const customWithOption = column({
  storage: nativeStorage("sqlite", "TEXT COLLATE NOCASE"),
})

expectTypeOf<ColumnStorageDialectOf<typeof customWithOption>>().toEqualTypeOf<"sqlite">()
expectTypeOf<
  ColumnStorageDeclarationOf<typeof customWithOption>
>().toEqualTypeOf<"TEXT COLLATE NOCASE">()

// Storage metadata does not change the existing application type axes.
expectTypeOf<ColumnStorageOf<typeof definitions.json>>().toMatchTypeOf<
  PortableColumnStorage<"json">
>()
