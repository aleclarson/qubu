import { findQubuDirective } from "./directive.ts"
import { qubuGlobals, type QubuGlobal } from "./globals.ts"

export { qubuGlobals } from "./globals.ts"
export type { QubuGlobal } from "./globals.ts"
import { findQubuReferences } from "./references.ts"

export interface QubuVitePluginOptions {
  /** Module specifier used for injected imports. @default "qubu" */
  readonly module?: string
  /** Restrict transformation to matching module IDs. */
  readonly include?: RegExp | ((id: string) => boolean)
  /** Exclude matching module IDs. */
  readonly exclude?: RegExp | ((id: string) => boolean)
  /** Override the auto-importable public Qubu names. */
  readonly globals?: readonly QubuGlobal[]
}

export interface QubuViteTransformResult {
  readonly code: string
  readonly map: null
}

/** A Vite-compatible plugin without a runtime dependency on Vite itself. */
export interface QubuVitePlugin {
  readonly name: "qubu:compiler-hint"
  readonly enforce: "pre"
  transform(code: string, id: string): QubuViteTransformResult | null
}

const scriptExtension = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/

export function qubu(options: QubuVitePluginOptions = {}): QubuVitePlugin {
  const moduleId = options.module ?? "qubu"
  const globals = options.globals ?? qubuGlobals

  return {
    name: "qubu:compiler-hint",
    enforce: "pre",
    transform(code, id) {
      const filename = id.split("?", 1)[0]

      if (!scriptExtension.test(filename)) {
        return null
      }

      if (filename.includes("/node_modules/")) {
        return null
      }

      if (options.include && !matches(options.include, id)) {
        return null
      }

      if (options.exclude && matches(options.exclude, id)) {
        return null
      }

      const directive = findQubuDirective(code)

      if (!directive) {
        return null
      }

      const references = findQubuReferences(code, globals)

      if (references.length === 0) {
        return null
      }

      const imports = `import { ${references.join(", ")} } from ${JSON.stringify(moduleId)};\n`

      return {
        code: `${code.slice(0, directive.end)}${imports}${code.slice(directive.end)}`,
        map: null,
      }
    },
  }
}

export const qubuVitePlugin = qubu
export default qubu

function matches(filter: RegExp | ((id: string) => boolean), id: string) {
  if (typeof filter === "function") {
    return filter(id)
  }

  filter.lastIndex = 0
  return filter.test(id)
}
