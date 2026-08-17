export interface QubuToken {
  readonly value: string
  readonly start: number
  readonly end: number
  readonly kind: 'identifier' | 'punctuator'
}

const identifierStart = /[A-Za-z_$]/
const identifierPart = /[A-Za-z0-9_$]/
const punctuators = [
  '>>>=',
  '===',
  '!==',
  '**=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '...',
  '=>',
  '?.',
  '==',
  '!=',
  '<=',
  '>=',
  '++',
  '--',
  '&&',
  '||',
  '??',
  '**',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
]

export function tokenize(source: string): readonly QubuToken[] {
  const tokens: QubuToken[] = []
  let cursor = 0

  while (cursor < source.length) {
    const character = source[cursor]

    if (isWhitespace(character)) {
      cursor += 1
      continue
    }

    if (source.startsWith('//', cursor)) {
      cursor = skipLineComment(source, cursor)
      continue
    }

    if (source.startsWith('/*', cursor)) {
      cursor = skipBlockComment(source, cursor)
      continue
    }

    if (character === "'" || character === '"') {
      cursor = skipQuotedString(source, cursor)
      continue
    }

    if (character === '`') {
      cursor = skipTemplate(source, cursor)
      continue
    }

    if (isIdentifierStart(character)) {
      const start = cursor
      cursor += 1
      while (cursor < source.length && isIdentifierPart(source[cursor])) {
        cursor += 1
      }
      tokens.push({
        kind: 'identifier',
        value: source.slice(start, cursor),
        start,
        end: cursor,
      })
      continue
    }

    if (isNumberStart(character)) {
      cursor = skipNumber(source, cursor)
      continue
    }

    const punctuator = punctuators.find(value =>
      source.startsWith(value, cursor)
    )
    if (punctuator) {
      tokens.push({
        kind: 'punctuator',
        value: punctuator,
        start: cursor,
        end: cursor + punctuator.length,
      })
      cursor += punctuator.length
      continue
    }

    tokens.push({
      kind: 'punctuator',
      value: character,
      start: cursor,
      end: cursor + 1,
    })
    cursor += 1
  }

  return tokens
}

function skipLineComment(source: string, start: number) {
  const lineEnd = source.indexOf('\n', start + 2)
  return lineEnd === -1 ? source.length : lineEnd + 1
}

function skipBlockComment(source: string, start: number) {
  const commentEnd = source.indexOf('*/', start + 2)
  return commentEnd === -1 ? source.length : commentEnd + 2
}

function skipQuotedString(source: string, start: number) {
  const quote = source[start]
  let cursor = start + 1

  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (source[cursor] === quote) return cursor + 1
    cursor += 1
  }

  return source.length
}

function skipTemplate(source: string, start: number) {
  let cursor = start + 1

  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (source[cursor] === '`') return cursor + 1
    cursor += 1
  }

  return source.length
}

function skipNumber(source: string, start: number) {
  let cursor = start
  while (cursor < source.length && /[A-Za-z0-9._]/.test(source[cursor])) {
    cursor += 1
  }
  return cursor
}

function isIdentifierStart(character: string | undefined): character is string {
  return character !== undefined && identifierStart.test(character)
}

function isIdentifierPart(character: string | undefined): character is string {
  return character !== undefined && identifierPart.test(character)
}

function isNumberStart(character: string | undefined) {
  return character !== undefined && /[0-9]/.test(character)
}

function isWhitespace(character: string | undefined) {
  return character !== undefined && /\s/.test(character)
}
