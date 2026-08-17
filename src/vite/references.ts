import { tokenize, type QubuToken } from './tokens.ts'
import type { QubuGlobal } from './globals.ts'

export function findQubuReferences(
  source: string,
  globals: readonly QubuGlobal[]
): readonly QubuGlobal[] {
  const tokens = tokenize(source)
  const available = new Set(globals)
  const boundNames = collectBoundNames(tokens)
  const used = new Set<QubuGlobal>()

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'identifier') continue
    if (!available.has(token.value as QubuGlobal)) continue
    if (boundNames.has(token.value)) continue
    if (!isReference(tokens, index)) continue
    used.add(token.value as QubuGlobal)
  }

  return globals.filter(name => used.has(name))
}

function collectBoundNames(tokens: readonly QubuToken[]) {
  const boundNames = new Set<string>()

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value

    if (value === 'import') {
      collectImportBindings(tokens, index, boundNames)
      continue
    }

    if (value === 'const' || value === 'let' || value === 'var') {
      collectVariableBinding(tokens, index + 1, boundNames)
      continue
    }

    if (
      value === 'function' ||
      value === 'class' ||
      value === 'interface' ||
      value === 'type' ||
      value === 'enum' ||
      value === 'namespace'
    ) {
      addNextIdentifier(tokens, index + 1, boundNames)
      if (value === 'function') {
        collectParameterBindings(tokens, index + 1, boundNames)
      }
      continue
    }

    if (value === 'catch') {
      collectParameterBindings(tokens, index + 1, boundNames)
      continue
    }

    if (value === '=>') {
      const previous = tokens[index - 1]
      if (previous?.kind === 'identifier') {
        boundNames.add(previous.value)
      } else if (previous?.value === ')') {
        const opening = findMatchingOpening(tokens, index - 1, '(', ')')
        if (opening !== -1) {
          collectIdentifiers(tokens, opening + 1, index - 1, boundNames)
        }
      }
    }
  }

  return boundNames
}

function collectImportBindings(
  tokens: readonly QubuToken[],
  importIndex: number,
  boundNames: Set<string>
) {
  const next = tokens[importIndex + 1]
  if (!next || next.value === '(' || next.value === '.') return

  for (let index = importIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === 'from' || token.value === ';') break
    if (token.kind === 'identifier' && token.value !== 'type') {
      boundNames.add(token.value)
    }
  }
}

function collectVariableBinding(
  tokens: readonly QubuToken[],
  start: number,
  boundNames: Set<string>
) {
  const first = tokens[start]
  if (!first) return

  if (first.kind === 'identifier') {
    boundNames.add(first.value)
    return
  }

  if (first.value !== '{' && first.value !== '[') return
  const closing = findMatchingClosing(tokens, start)
  if (closing !== -1) {
    collectIdentifiers(tokens, start + 1, closing, boundNames)
  }
}

function collectParameterBindings(
  tokens: readonly QubuToken[],
  start: number,
  boundNames: Set<string>
) {
  const opening = tokens.findIndex(
    (token, index) => index >= start && token.value === '('
  )
  if (opening === -1) return
  const closing = findMatchingClosing(tokens, opening)
  if (closing !== -1) {
    collectIdentifiers(tokens, opening + 1, closing, boundNames)
  }
}

function collectIdentifiers(
  tokens: readonly QubuToken[],
  start: number,
  end: number,
  boundNames: Set<string>
) {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]
    if (token.kind === 'identifier' && token.value !== 'as') {
      boundNames.add(token.value)
    }
  }
}

function addNextIdentifier(
  tokens: readonly QubuToken[],
  start: number,
  boundNames: Set<string>
) {
  const token = tokens[start]
  if (token?.kind === 'identifier') boundNames.add(token.value)
}

function isReference(tokens: readonly QubuToken[], index: number) {
  const previous = tokens[index - 1]?.value
  const next = tokens[index + 1]?.value

  if (previous === '.' || previous === '?.' || previous === '#') return false
  if (next === ':') return false
  if (previous === 'interface' || previous === 'type') return false
  return true
}

function findMatchingClosing(tokens: readonly QubuToken[], opening: number) {
  const open = tokens[opening]?.value
  const close = open === '{' ? '}' : open === '[' ? ']' : ')'
  return findMatchingOpening(tokens, opening, open, close, true)
}

function findMatchingOpening(
  tokens: readonly QubuToken[],
  start: number,
  open: string,
  close: string,
  forward = false
) {
  let depth = 0
  const step = forward ? 1 : -1
  const end = forward ? tokens.length : -1

  for (let index = start; index !== end; index += step) {
    if (tokens[index].value === open) depth += 1
    if (tokens[index].value === close) depth -= 1
    if (depth === 0) return index
  }

  return -1
}
