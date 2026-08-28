import type { RenderContext } from "../../core/fragment.ts"
import { snakeCaseIdentifier } from "../../core/naming.ts"
import { identifier } from "../../core/primitives/identifier.ts"
import { isExpression } from "../../expressions/types.ts"
import { queryValidationError } from "../errors.ts"
import { omit } from "../omit.ts"
import type { Selection } from "../selection.ts"

export function renderSelection(selection: Selection, context: RenderContext) {
  assertNamedSelection(selection)
  const entries = Object.entries(selection).filter(([, expression]) => expression !== omit)

  if (entries.length === 0) {
    throw queryValidationError({
      code: "invalid-selection",
      context: "select.projection",
      path: ["selection"],
      message: "select() requires at least one field",
      hint: "Pass a named projection object with at least one expression.",
    })
  }

  entries.forEach(([name, expression], index) => {
    if (index > 0) {
      context.append(", ")
    }

    if (!isExpression(expression)) {
      throw queryValidationError({
        code: "invalid-selection",
        context: "select.projection",
        path: ["selection", name],
        message: `Selection field "${name}" must be an expression`,
        hint: "Use a Qubu expression such as table.column, value(), or a function.",
      })
    }

    const outputName = context.projectionMode === "result" ? name : snakeCaseIdentifier(name)

    context.render(expression)
    context.append(" AS ")
    context.render(identifier(outputName))
  })
}

export function selectionRow(selection: Selection): Record<string, unknown> {
  assertNamedSelection(selection)
  return Object.fromEntries(
    Object.entries(selection)
      .filter(([, expression]) => expression !== omit)
      .map(([name]) => [name, undefined]),
  )
}

function assertNamedSelection(selection: Selection) {
  if (Array.isArray(selection)) {
    throw queryValidationError({
      code: "invalid-selection",
      context: "select.projection",
      path: ["selection"],
      message: "Selection must be a named object projection",
      hint: "Pass { fieldName: expression } to select().",
    })
  }
}
