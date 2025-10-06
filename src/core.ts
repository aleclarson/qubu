import { StandardSchemaV1 } from "@standard-schema/spec";
import { PgColumn } from "./definition/column.ts";

const $dataType = Symbol.for("dataType");
const $ident = Symbol.for("ident");
const $param = Symbol.for("param");
const $syntax = Symbol.for("syntax");
const $sequence = Symbol.for("sequence");

/**
 * A database type.
 */
export type DataType<Id extends string = string, In = any, Out = any> = {
  [$dataType]: Id;
  serialize: ((jsType: In) => unknown) | StandardSchemaV1<In, unknown>;
  parse: (sqlType: unknown) => Out;
};

export type DataTypeIn<T extends DataType> = T extends {
  serialize: infer TSerialize;
}
  ? TSerialize extends StandardSchemaV1<any, any>
    ? StandardSchemaV1.InferInput<TSerialize>
    : TSerialize extends (jsType: infer In) => unknown
    ? In
    : never
  : never;

export type DataTypeOut<T extends DataType> = ReturnType<T["parse"]>;

export interface pgTypes {
  [$dataType]: DataType;
  [$ident]: SQL.Identifier;
  [$syntax]: SQL.Syntax;
  [$sequence]: SQL.Sequence;
  [$param]: SQL.Param;
}

/**
 * Type guard for database symbols.
 */
function is<T extends keyof pgTypes>(
  value: unknown,
  type: T
): value is pgTypes[T] {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, type)
  );
}

/**
 * Declare a database type, with serialization and parsing functions.
 */
export function dataType<Id extends string, In, Out>(
  id: Id,
  serialize: (jsType: In) => any,
  parse: (sqlType: any) => Out
) {
  function type(name = ""): PgColumn<In, Out> {
    return new PgColumn(name, type);
  }
  type[$dataType] = id;
  type.serialize = serialize;
  type.parse = parse;
  return type;
}

function typedSerialize<T extends DataType>(type: T, value: DataTypeIn<T>) {
  if (value === null) {
    return null;
  }
  if ("~standard" in type.serialize) {
    const parsed = type.serialize["~standard"].validate(value);
    if (parsed instanceof Promise) {
      throw new Error("[yiss] Async validation is not supported");
    }
    if (parsed.issues) {
      throw Object.assign(new Error(), parsed.issues[0]);
    }
    return parsed.value;
  }
  return type.serialize(value);
}

/**
 * Declare an array variant of a given data type.
 */
export function array<Id extends string, In, Out>(
  type: DataType<Id, In, Out>
): DataType<`${Id}[]`, In[], Out[]> {
  return dataType(
    `${type[$dataType]}[]`,
    (data: In[]) => data.map(typedSerialize.bind(null, type)),
    (data: any[]) => data.map(type.parse)
  );
}

/**
 * An escape hatch for raw SQL.
 */
export const unsafe = (sql: string): SQL.Syntax => ({ [$syntax]: sql });

/**
 * Declare an identifier. Often refers to a column or table name.
 */
export const ident = <Id extends string, T extends DataType = any>(
  id: Id,
  config?: { dataType?: T; schema?: string; table?: string }
): SQL.Identifier<Id, T> => ({
  [$ident]: id,
  dataType: config?.dataType,
  schema: config?.schema,
  table: config?.table,
});

/**
 * A token returned from a `tokenize()` call.
 *
 * Notably, JS arrays are not flattened, but treated as a
 * parenthesized expression.
 */
type Token = string | SQL.Identifier | SQL.Param | SQL.Sequence | Token[];

export class SQL<Out = any> {
  dataType: DataType<string, any, Out> | null = null;

  constructor(public tokens: Token[]) {}

  /**
   * Use the `as` keyword to alias the SQL object.
   */
  as(alias: string) {
    return sql(sql.sequence([this, unsafe("as"), ident(alias)])).$type(
      this.dataType
    );
  }

  /**
   * Add an `asc` modifier to the SQL object.
   */
  asc() {
    return sql(sql.sequence([this, unsafe("asc")]));
  }

  /**
   * Add a `desc` modifier to the SQL object.
   */
  desc() {
    return sql(sql.sequence([this, unsafe("desc")]));
  }

  /**
   * Set the data type of the SQL object, controlling how the result
   * is parsed.
   * @returns The same SQL object.
   */
  $type<T extends DataType>(dataType: T | null): SQL<DataTypeOut<T>> {
    this.dataType = dataType;
    return this as any;
  }

  /**
   * Wrap the SQL object in a new type, providing access to additional
   * methods.
   */
  withPrototype<T extends object>(type: new (sql: this) => T): T {
    return new type(this) as any;
  }

  toQuery(client: QueryClient) {
    const params: unknown[] = [];
    return {
      sql: renderQuery(client, this.tokens, params),
      params,
    };
  }
}

export namespace SQL {
  export type Primitive =
    | string
    | number
    | bigint
    | boolean
    | Date
    | null
    | undefined;

  export type Part = pgTypes[keyof pgTypes] | SQL | Primitive | Part[];

  /**
   * An escaped string.
   */
  export type Param = { [$param]: string | unknown[] };

  /**
   * An escape hatch for raw SQL.
   */
  export type Syntax = { [$syntax]: string };

  /**
   * A list of simple tokens, with a given separator between each item.
   */
  export type Sequence = {
    [$sequence]: Token[];
    separator: SQL.Syntax;
  };

  /**
   * An identifier, safe from SQL injection. Often refers to a column or
   * table name.
   */
  export type Identifier<
    Name extends string = string,
    T extends DataType = any
  > = {
    [$ident]: Name;
    dataType: T | undefined;
    /** Should only exist if this is a table or column, and the schema is not "public". */
    schema: string | undefined;
    /** Should only exist if this is a column. */
    table: string | undefined;
  };
}

/**
 * Concatenate chunks of SQL. If later nested in a `SQL.Sequence`, the
 * chunks will be joined with that sequence's separator. Otherwise,
 * they're joined with a space.
 *
 * - SQL instances are flattened (e.g. `sql(a, sql(b, c))` is the same as `sql(a, b, c)`).
 * - Undefined values are ignored (e.g. `sql(a, undefined, b)` is the same as `sql(a, b)`).
 */
export declare function sql<T extends readonly SQL.Part[]>(
  ...parts: T
): SQL<unknown>;

export declare function sql<T extends readonly SQL.Part[]>(
  parts: T
): SQL<unknown>;

/** Whitespace token */
export const space = unsafe(" ");
/** Comma token */
export const comma = unsafe(",");

/**
 * Represents a sequence of tokens, with a given separator between
 * each item.
 */
sql.sequence = (
  parts: SQL.Part[],
  separator: SQL.Syntax = space
): Token | SQL.Sequence | undefined => {
  const tokens = tokenize(parts);
  if (tokens.length < 2) {
    return tokens[0];
  }
  return { [$sequence]: tokens, separator } satisfies SQL.Sequence;
};

/**
 * Coerce a JavaScript array to an escaped SQL array.
 */
sql.arrayLiteral = (data: unknown[]) => ({ [$param]: data });

/**
 * Coerce a JavaScript value to an escaped SQL value.
 */
sql.literal = (data: any) => {
  if (typeof data === "string" || Array.isArray(data)) {
    return { [$param]: data };
  }
  if (data !== null && typeof data === "object") {
    if (
      typeof data.toJSON !== "function" &&
      Object.prototype.toString.call(data.toJSON) !== "[object Object]"
    ) {
      throw new Error("sql.literal: toJSON is not a function");
    }
    return { [$param]: JSON.stringify(data) };
  }
  return data;
};

/**
 * Simplify the array of tokens such that only raw SQL, escaped
 * values, identifiers, and parenthesized expressions are left over.
 *
 * ⚠︎ Arrays are wrapped in parentheses, not flattened.
 */
function tokenize(parts: SQL.Part[]): Token[] {
  const tokens: Token[] = [];
  for (const part of parts) {
    if (part === undefined) {
      continue;
    }
    let token: Token | undefined;
    if (
      part === null ||
      typeof part === "boolean" ||
      typeof part === "number" ||
      typeof part === "bigint"
    ) {
      token = String(part);
    } else if (typeof part === "string") {
      token = { [$param]: part };
    } else if (Array.isArray(part)) {
      token = tokenize(part); // parenthesized expression
    } else if (typeof part === "object") {
      if (part instanceof SQL) {
        for (const token of part.tokens) {
          tokens.push(token);
        }
        continue;
      }
      if (is(part, $ident) || is(part, $param) || is(part, $sequence)) {
        token = part;
      } else if (is(part, $dataType)) {
        token = part[$dataType]; // Type name
      } else if (is(part, $syntax)) {
        token = part[$syntax]; // Raw SQL
      } else if (part instanceof Date) {
        token = { [$param]: part.toISOString() };
      }
    }
    if (!token) {
      throw new Error(`Invalid part: ${Object.prototype.toString.call(part)}`);
    }
    tokens.push(token);
  }
  return tokens;
}

// export function updateSetObject(object: Record<string, unknown>) {
//   return sql(Object.entries(object).flatMap(([key, value]) => {
//     return [ident(key), "=", param(key)] as const
//   }))
// }

// export function whereObject(object: Record<string, unknown>) {
//   return sql(Object.entries(object).flatMap(([key, value]) => {
//     return [ident(key), "=", param(key)] as const
//   }))
// }

export type QueryClient = { escapeIdentifier: (ident: string) => string };

export function renderQuery(
  client: QueryClient,
  tokens: Token[],
  params: unknown[]
): string {
  let sql = "";
  for (const token of tokens) {
    sql += render(client, token, params);
  }
  return sql;
}

function render(client: QueryClient, token: Token, params: unknown[]): string {
  if (typeof token === "string") {
    return token;
  }
  if (is(token, $ident)) {
    return client.escapeIdentifier(token[$ident]);
  }
  if (is(token, $param)) {
    return "$" + params.push(token[$param]);
  }
  if (is(token, $sequence)) {
    let sequence = "";
    for (let i = 0; i < token[$sequence].length; i++) {
      if (i > 0) sequence += token.separator[$syntax];
      sequence += render(client, token[$sequence][i], params);
    }
    return sequence;
  }
  return "(" + renderQuery(client, token, params) + ")";
}
