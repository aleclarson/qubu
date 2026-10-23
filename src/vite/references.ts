import type { QubuGlobal } from "./globals.ts"
import { tokenize, type QubuToken } from "./tokens.ts"

interface BoundName {
  readonly name: string
  /** Token range the binding covers; module scope uses the whole file. */
  readonly start: number
  readonly end: number
}

export function findQubuReferences(
  source: string,
  globals: readonly QubuGlobal[],
): readonly QubuGlobal[] {
  const tokens = tokenize(source)
  const available = new Set(globals)
  const boundNames = collectBoundNames(tokens)
  const used = new Set<QubuGlobal>()

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "identifier") {
      continue
    }

    if (!available.has(token.value as QubuGlobal)) {
      continue
    }

    if (
      boundNames.some(
        (binding) =>
          binding.name === token.value && binding.start <= index && index <= binding.end,
      )
    ) {
      continue
    }

    if (!isReference(tokens, index)) {
      continue
    }

    used.add(token.value as QubuGlobal)
  }

  return globals.filter((name) => used.has(name))
}

function collectBoundNames(tokens: readonly QubuToken[]) {
  const boundNames: BoundName[] = []
  // Innermost enclosing `{...}` for each token, so bindings inside a block do
  // not suppress module-scope references.
  const blockEnds = matchingCloses(tokens)
  const blockStack: number[] = []
  const fileEnd = tokens.length - 1
  const bind = (name: string) => {
    const block = blockStack.at(-1)
    boundNames.push({
      name,
      start: block === undefined ? 0 : block,
      end: block === undefined ? fileEnd : (blockEnds.get(block) ?? fileEnd),
    })
  }
  const bindScoped = (name: string, blockIndex: number) => {
    boundNames.push({
      name,
      start: blockIndex,
      end: blockEnds.get(blockIndex) ?? fileEnd,
    })
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value

    if (value === "{") {
      blockStack.push(index)
    } else if (value === "}") {
      blockStack.pop()
    }

    if (value === "import") {
      collectImportBindings(tokens, index, bind)
      continue
    }

    if (value === "const" || value === "let" || value === "var") {
      collectVariableBinding(tokens, index + 1, bind)
      continue
    }

    if (
      value === "function" ||
      value === "class" ||
      value === "interface" ||
      value === "type" ||
      value === "enum" ||
      value === "namespace"
    ) {
      addNextIdentifier(tokens, index + 1, bind)
      if (value === "function") {
        collectParameterBindings(tokens, index + 1, bind, bindScoped)
      }

      continue
    }

    if (value === "catch") {
      collectParameterBindings(tokens, index + 1, bind, bindScoped)
      continue
    }

    if (value === "=>") {
      const previous = tokens[index - 1]
      const names: string[] = []

      if (previous?.kind === "identifier") {
        names.push(previous.value)
      } else if (previous?.value === ")") {
        const opening = findMatchingOpening(tokens, index - 1, "(", ")")

        if (opening !== -1) {
          collectIdentifiers(tokens, opening + 1, index - 1, (name) => names.push(name))
        }
      }

      const body = tokens[index + 1]

      for (const name of names) {
        if (body?.value === "{") {
          bindScoped(name, index + 1)
        } else {
          boundNames.push({ name, start: index, end: fileEnd })
        }
      }
      continue
    }

    if (value === "${") {
      blockStack.push(index)
    }
  }

  return boundNames
}

/** Map every `{`, `(`, `[`, or `${` open index to its matching close index. */
function matchingCloses(tokens: readonly QubuToken[]) {
  const pairs = new Map<number, number>()
  const open: number[] = []
  const openers = new Set(["{", "(", "[", "${"])

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value

    if (openers.has(value)) {
      open.push(index)
      continue
    }

    if (value === "}" || value === ")" || value === "]") {
      const candidate = open.pop()

      if (candidate !== undefined) {
        pairs.set(candidate, index)
      }
    }
  }

  return pairs
}

function collectImportBindings(
  tokens: readonly QubuToken[],
  importIndex: number,
  bind: (name: string) => void,
) {
  const next = tokens[importIndex + 1]

  if (!next || next.value === "(" || next.value === ".") {
    return
  }

  for (let index = importIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.value === "from" || token.value === ";") {
      break
    }

    if (token.kind === "identifier" && token.value !== "type") {
      bind(token.value)
    }
  }
}

function collectVariableBinding(
  tokens: readonly QubuToken[],
  start: number,
  bind: (name: string) => void,
) {
  const first = tokens[start]

  if (!first) {
    return
  }

  if (first.kind === "identifier") {
    bind(first.value)
    return
  }

  if (first.value !== "{" && first.value !== "[") {
    return
  }

  const closing = findMatchingClosing(tokens, start)

  if (closing !== -1) {
    collectIdentifiers(tokens, start + 1, closing, bind)
  }
}

function collectParameterBindings(
  tokens: readonly QubuToken[],
  start: number,
  bind: (name: string) => void,
  bindScoped: (name: string, blockIndex: number) => void,
) {
  const opening = tokens.findIndex((token, index) => index >= start && token.value === "(")

  if (opening === -1) {
    return
  }

  const closing = findMatchingClosing(tokens, opening)

  if (closing === -1) {
    return
  }

  const body = tokens[closing + 1]

  collectIdentifiers(tokens, opening + 1, closing, (name) =>
    body?.value === "{" ? bindScoped(name, closing + 1) : bind(name),
  )
}

function collectIdentifiers(
  tokens: readonly QubuToken[],
  start: number,
  end: number,
  bind: (name: string) => void,
) {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]

    if (token.kind === "identifier" && token.value !== "as") {
      bind(token.value)
    }
  }
}

function addNextIdentifier(
  tokens: readonly QubuToken[],
  start: number,
  bind: (name: string) => void,
) {
  const token = tokens[start]

  if (token?.kind === "identifier") {
    bind(token.value)
  }
}

function isReference(tokens: readonly QubuToken[], index: number) {
  const previous = tokens[index - 1]?.value
  const next = tokens[index + 1]?.value

  if (previous === "." || previous === "?." || previous === "#") {
    return false
  }

  if (next === ":") {
    return false
  }

  if (previous === "interface" || previous === "type") {
    return false
  }

  return true
}

function findMatchingClosing(tokens: readonly QubuToken[], opening: number) {
  const open = tokens[opening]?.value
  const close = open === "{" ? "}" : open === "[" ? "]" : ")"

  return findMatchingOpening(tokens, opening, open, close, true)
}

function findMatchingOpening(
  tokens: readonly QubuToken[],
  start: number,
  open: string,
  close: string,
  forward = false,
) {
  let depth = 0
  const step = forward ? 1 : -1
  const end = forward ? tokens.length : -1

  for (let index = start; index !== end; index += step) {
    if (tokens[index].value === open) {
      depth += 1
    }

    if (tokens[index].value === close) {
      depth -= 1
    }

    if (depth === 0) {
      return index
    }
  }

  return -1
}
