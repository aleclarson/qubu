import {
  fragment,
  parenthesize,
  sequence,
  type AnyFragment,
  type Fragment,
  type InheritedMetadata,
} from '../fragment.ts'

export { parenthesize, sequence }

export function commaSeparated<const TParts extends readonly AnyFragment[]>(
  parts: TParts
): Fragment<InheritedMetadata<TParts[number]>> {
  return sequence(parts, ', ')
}

export function keyword<TPart extends AnyFragment | undefined>(
  value: string,
  part?: TPart
): Fragment<TPart extends AnyFragment ? InheritedMetadata<TPart> : never> {
  return fragment<TPart extends AnyFragment ? InheritedMetadata<TPart> : never>(
    context => {
      context.append(value)
      if (part) {
        context.append(' ')
        context.render(part)
      }
    }
  )
}
