export interface QubuDirective {
  readonly end: number
}

export function findQubuDirective(source: string): QubuDirective | null {
  let cursor = skipTrivia(source, 0)

  while (cursor < source.length && isQuote(source[cursor])) {
    const literal = readString(source, cursor)
    if (!literal) break

    let statementEnd = literal.end
    if (source[statementEnd] === ';') statementEnd += 1

    const next = skipTrivia(source, statementEnd)
    if (literal.value === 'use qubu') {
      return { end: next }
    }

    if (next >= source.length || !isQuote(source[next])) break
    cursor = next
  }

  return null
}

function skipTrivia(source: string, start: number) {
  let cursor = start

  while (cursor < source.length) {
    if (isWhitespace(source[cursor])) {
      cursor += 1
      continue
    }

    if (source.startsWith('//', cursor)) {
      const lineEnd = source.indexOf('\n', cursor + 2)
      cursor = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }

    if (source.startsWith('/*', cursor)) {
      const commentEnd = source.indexOf('*/', cursor + 2)
      cursor = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }

    if (cursor === 0 && source.startsWith('#!', cursor)) {
      const lineEnd = source.indexOf('\n', cursor + 2)
      cursor = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }

    break
  }

  return cursor
}

function readString(source: string, start: number) {
  const quote = source[start]
  let cursor = start + 1
  let value = ''

  while (cursor < source.length) {
    const character = source[cursor]
    if (character === '\\') {
      // Escaped directive text is deliberately not treated as the hint.
      if (cursor + 1 >= source.length) return null
      value += source[cursor + 1]
      cursor += 2
      continue
    }
    if (character === quote) {
      return { value, end: cursor + 1 }
    }
    if (character === '\n' || character === '\r') return null
    value += character
    cursor += 1
  }

  return null
}

function isQuote(character: string | undefined): character is "'" | '"' {
  return character === "'" || character === '"'
}

function isWhitespace(character: string | undefined) {
  return character !== undefined && /\s/.test(character)
}
