import { StandardSchemaV1 } from "@standard-schema/spec";
import { Column } from "./definition/column.ts";
import { Table } from "./definition/table.ts";
import {
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgType,
  SQLAlias,
  SQLDecoder,
} from "./symbols.ts";
import { isToken, pgTokens, Token, tokenize } from "./tokens.ts";

/**
 * Declare a database type, with serialization and parsing functions.
 */
export function pgType<Id extends string, In, Out>(
  id: Id,
  encode: (jsType: In) => any,
  decode: (sqlType: any) => Out
) {
  function type(name = "") {
    return new Column(name, type, true);
  }
  type[PgType] = id;
  type.encode = encode;
  type.decode = decode;
  return type;
}

function encode<T extends SQL.Type>(type: T, value: SQL.InferInput<T>) {
  if (value === null) {
    return null;
  }
  if ("~standard" in type.encode) {
    const parsed = type.encode["~standard"].validate(value);
    if (parsed instanceof Promise) {
      throw new Error("[yiss] Async validation is not supported");
    }
    if (parsed.issues) {
      throw Object.assign(new Error(), parsed.issues[0]);
    }
    return parsed.value;
  }
  return type.encode(value);
}

/**
 * Declare an array variant of a given data type.
 */
export function pgArrayType<Id extends string, In, Out>(
  type: SQL.Type<Id, In, Out>
): SQL.Type<`${Id}[]`, In[], Out[]> {
  return pgType(
    `${type[PgType]}[]`,
    (data: In[]) => data.map(encode.bind(null, type)),
    (data: any[]) => data.map(type.decode)
  );
}

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = (syntax: string): SQL.Syntax => ({ [PgSyntax]: syntax });

/**
 * Declare an identifier. Often refers to a column or table name.
 */
export function ident<Id extends string, TColumn extends Column>(
  id: Id,
  context: TColumn
): SQL.ColumnIdentifier<Id, TColumn>;
export function ident<Id extends string>(
  id: Id,
  context?: Table | Column
): SQL.Identifier<Id>;

/** @internal */
export function ident<Id extends string>(
  id: Id,
  context?: Table | Column
): SQL.Identifier<Id> {
  return { [PgIdent]: id, context };
}

export class SQL<Out = any> {
  protected [SQLDecoder]: ((sqlType: unknown) => Out) | null = null;
  protected [SQLAlias]: string | null = null;

  constructor(public tokens: Token[]) {}

  /**
   * Set the alias for this SQL object.
   */
  as(alias: string) {
    this[SQLAlias] = alias;
    return this;
  }

  /**
   * Set the data type of the SQL object, controlling how the result
   * is parsed.
   * @returns The same SQL object.
   */
  mapWith<T extends SQL.Type>(dataType: T | null): SQL<SQL.InferOutput<T>>;
  mapWith<T>(decoder: ((sqlType: unknown) => T) | null): SQL<T>;
  mapWith(dataType: SQL.Type | ((sqlType: unknown) => unknown) | null) {
    // @ts-expect-error
    this.decode =
      dataType && typeof dataType !== "function" ? dataType.decode : dataType;
    return this as any;
  }

  toQuery() {
    const params: unknown[] = [];
    return {
      sql: renderQuery(this.tokens, params),
      params,
    };
  }
}

export declare namespace SQL {
  export type Primitive =
    | string
    | number
    | bigint
    | boolean
    | Date
    | null
    | undefined;

  export type Part = pgTokens[keyof pgTokens] | SQL | Primitive | Part[];

  /**
   * An escaped string.
   */
  export type Param = { [PgParam]: string | unknown[] };

  /**
   * An escape hatch for raw SQL.
   */
  export type Syntax = { [PgSyntax]: string };

  /**
   * A sequence of tokens, with a given separator between each item.
   */
  export type Sequence = {
    [PgSequence]: Token[];
    separator: SQL.Syntax;
  };

  /**
   * An identifier, safe from SQL injection. Often refers to a column or
   * table name.
   */
  export type Identifier<Name extends string = string> = {
    [PgIdent]: Name;
    context?: Column;
  };

  export type ColumnIdentifier<
    Name extends string = string,
    TColumn extends Column = Column
  > = Identifier<Name> & {
    context: TColumn;
  };

  /**
   * A data type in PostgreSQL, with encoding and decoding functions.
   */
  export type Type<Id extends string = string, In = any, Out = any> = {
    [PgType]: Id;
    encode: ((jsType: In) => unknown) | StandardSchemaV1<In, unknown>;
    decode: (sqlType: unknown) => Out;
  };

  /**
   * Infer the input type of a given data type.
   */
  export type InferInput<T extends Type> = T extends {
    encode: infer TEncode;
  }
    ? TEncode extends StandardSchemaV1<any, any>
      ? StandardSchemaV1.InferInput<TEncode>
      : TEncode extends (jsType: infer In) => unknown
      ? In
      : never
    : never;

  /**
   * Infer the output type of a given data type.
   */
  export type InferOutput<T extends Type | SQL | ColumnIdentifier> =
    T extends Type<any, any, infer TOutput>
      ? TOutput
      : T extends SQL<infer TOutput>
      ? TOutput
      : T extends ColumnIdentifier<string, Column<any, infer TColumnOutput>>
      ? TColumnOutput
      : unknown;
}

/**
 * Concatenate chunks of SQL. If later nested in a `SQL.Sequence`, the
 * chunks will be joined with that sequence's separator. Otherwise,
 * they're joined with a space.
 *
 * SQL instances are flattened (e.g. `sql(a, sql(b, c))` is the same
 * as `sql(a, b, c)`).
 */
export function sql<T extends readonly SQL.Part[]>(...parts: T) {
  return new SQL(tokenize(parts));
}

sql.fromArray = (parts: readonly SQL.Part[]) => new SQL(tokenize(parts));

/** Empty token */
export const empty = unsafe("");
/** Whitespace token */
export const space = unsafe(" ");
/** Comma token */
export const comma = unsafe(",");
/** Dot token */
export const dot = unsafe(".");

/**
 * A sequence is a syntax unit made up of a list of tokens, with a
 * given separator between each item. If no separator is provided, the
 * tokens are joined with a space.
 */
export const sequence = (
  parts: readonly SQL.Part[],
  separator: SQL.Syntax = space
): Token | SQL.Sequence | undefined => {
  const tokens = tokenize(parts);
  if (tokens.length < 2) {
    return tokens[0];
  }
  return { [PgSequence]: tokens, separator } satisfies SQL.Sequence;
};

sql.unsafe = unsafe;
sql.sequence = sequence;
sql.ident = ident;

/**
 * Coerce a JavaScript array to an escaped SQL array.
 */
sql.arrayLiteral = (data: unknown[]) => ({ [PgParam]: data });

/**
 * Coerce a JavaScript value to an escaped SQL value.
 */
sql.literal = (data: any) => {
  if (typeof data === "string" || Array.isArray(data)) {
    return { [PgParam]: data };
  }
  if (data !== null && typeof data === "object") {
    if (
      typeof data.toJSON !== "function" &&
      Object.prototype.toString.call(data.toJSON) !== "[object Object]"
    ) {
      throw new Error("sql.literal: toJSON is not a function");
    }
    return { [PgParam]: JSON.stringify(data) };
  }
  return data;
};

/**
 * Cast a value to a given type.
 */
export const cast = <T>(value: SQL.Part, type: SQL.Type<string, any, T>) =>
  sql(sequence([value, unsafe("::"), type], empty)).mapWith(type);

export function renderQuery(tokens: Token[], params: unknown[]): string {
  let sql = "";
  for (const token of tokens) {
    sql += render(token, params);
  }
  return sql;
}

function render(token: Token, params: unknown[]): string {
  if (typeof token === "string") {
    return token;
  }
  if (isToken(token, PgIdent)) {
    return '"' + token[PgIdent].replace(/"/g, '""') + '"';
  }
  if (isToken(token, PgParam)) {
    const index = 1 + params.indexOf(token[PgParam]);
    return "$" + (index || params.push(token[PgParam]));
  }
  if (isToken(token, PgSequence)) {
    let sequence = "";
    for (let i = 0; i < token[PgSequence].length; i++) {
      if (i > 0) sequence += token.separator[PgSyntax];
      sequence += render(token[PgSequence][i], params);
    }
    return sequence;
  }
  return "(" + renderQuery(token, params) + ")";
}
