// Code adapted from https://github.com/porsager/postgres/blob/32feb259a3c9abffab761bd1758b3168d9e0cebc/src/types.js#L241

const escapeBackslash = /\\/g
const escapeQuote = /"/g

function arrayEscape(x) {
  return x.replace(escapeBackslash, '\\\\').replace(escapeQuote, '\\"')
}

export function arraySerializer(xs, serializer, options, typarray): string {
  if (Array.isArray(xs) === false) return xs

  if (!xs.length) return '{}'

  const first = xs[0]
  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = typarray === 1020 ? ';' : ','

  if (Array.isArray(first) && !first.type)
    return (
      '{' +
      xs
        .map(x => arraySerializer(x, serializer, options, typarray))
        .join(delimiter) +
      '}'
    )

  return (
    '{' +
    xs
      .map(x => {
        return x === null
          ? 'null'
          : '"' +
              arrayEscape(
                serializer ? serializer(x.type ? x.value : x) : '' + x
              ) +
              '"'
      })
      .join(delimiter) +
    '}'
  )
}
