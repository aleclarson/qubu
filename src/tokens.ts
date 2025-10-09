import { SQL } from "./core.ts";
import { Column } from "./definition/column.ts";
import { Table } from "./definition/table.ts";
import {
  PgIdent,
  PgParam,
  PgSequence,
  PgSyntax,
  PgType,
  SQLAlias,
} from "./symbols.ts";

export interface pgTokens {
  [PgType]: SQL.Type;
  [PgIdent]: SQL.Identifier;
  [PgSyntax]: SQL.Syntax;
  [PgSequence]: SQL.Sequence;
  [PgParam]: SQL.Param;
}

/**
 * Type guard for database tokens.
 */
export function isToken<T extends keyof pgTokens>(
  value: unknown,
  type: T
): value is pgTokens[T] {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, type)
  );
}

export function isColumnIdentifier(
  value: unknown
): value is SQL.ColumnIdentifier {
  return isToken(value, PgIdent) && value.context instanceof Column;
}

export function isTableIdentifier(
  value: unknown
): value is SQL.TableIdentifier {
  return isToken(value, PgIdent) && value.context instanceof Table;
}

/**
 * A token returned from a `tokenize()` call.
 *
 * Notably, JS arrays are not flattened, but treated as a
 * parenthesized expression.
 */
export type Token =
  | string
  | SQL.Identifier
  | SQL.Param
  | SQL.Sequence
  | Token[];

/**
 * Simplify the array of tokens such that only raw SQL, escaped
 * values, identifiers, and parenthesized expressions are left over.
 *
 * ⚠︎ Arrays are wrapped in parentheses, not flattened.
 */
export function tokenize(parts: readonly SQL.Part[]): Token[] {
  const tokens: Token[] = [];
  for (const part of parts) {
    let token: Token | undefined;
    if (part == null) {
      token = "null"; // Treat undefined as null
    } else if (
      typeof part === "boolean" ||
      typeof part === "number" ||
      typeof part === "bigint"
    ) {
      token = String(part);
    } else if (typeof part === "string") {
      token = { [PgParam]: part };
    } else if (Array.isArray(part)) {
      token = tokenize(part); // parenthesized expression
    } else if (typeof part === "object") {
      if (part instanceof SQL) {
        for (const token of part.tokens) {
          tokens.push(token);
        }
        if (part[SQLAlias]) {
          tokens.push("as", { [PgIdent]: part[SQLAlias] });
        }
        continue;
      }
      if (
        isToken(part, PgIdent) ||
        isToken(part, PgParam) ||
        isToken(part, PgSequence)
      ) {
        token = part;
      } else if (isToken(part, PgType)) {
        token = part[PgType]; // Type name
      } else if (isToken(part, PgSyntax)) {
        token = part[PgSyntax]; // Raw SQL
      } else if (part instanceof Date) {
        token = { [PgParam]: part.toISOString() };
      }
    }
    if (!token) {
      throw new Error(`Invalid part: ${Object.prototype.toString.call(part)}`);
    }
    tokens.push(token);
  }
  return tokens;
}
