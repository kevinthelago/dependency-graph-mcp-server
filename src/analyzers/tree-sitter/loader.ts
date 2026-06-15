/**
 * WASM grammar loader for web-tree-sitter.
 *
 * Caches loaded Language instances by wasm path so each grammar is only
 * initialized once per process. Rust/C++/Obj-C reuse this same loader.
 */

import Parser from 'web-tree-sitter'
import type { Language } from 'web-tree-sitter'
import { existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

export type { Language }

let initialized = false
const cache = new Map<string, Language>()

async function ensureInit(): Promise<void> {
  if (initialized) return
  await Parser.init()
  initialized = true
}

/**
 * Load a tree-sitter WASM grammar. Results are cached by resolved path.
 *
 * @param wasmPath  Absolute path to the `.wasm` file.
 */
export async function loadGrammar(wasmPath: string): Promise<Language> {
  const abs = resolve(wasmPath)
  const cached = cache.get(abs)
  if (cached) return cached

  await ensureInit()
  const lang = await Parser.Language.load(abs)
  cache.set(abs, lang)
  return lang
}

/**
 * Resolve the path to a tree-sitter WASM grammar.
 *
 * Search order:
 *   1. Explicit `wasmPath` option if provided.
 *   2. `TREE_SITTER_WASM_DIR` environment variable + `/<name>.wasm`.
 *   3. `vendor/grammars/<name>.wasm` relative to this package root.
 *
 * @param name  Grammar file stem, e.g. `"tree-sitter-python"`.
 */
export function resolveGrammarPath(
  name: string,
  options?: { wasmPath?: string; wasmDir?: string },
): string {
  if (options?.wasmPath) {
    return resolve(options.wasmPath)
  }

  const wasmDir =
    options?.wasmDir ??
    process.env['TREE_SITTER_WASM_DIR']

  if (wasmDir) {
    const p = join(wasmDir, `${name}.wasm`)
    if (existsSync(p)) return p
  }

  // Vendor directory adjacent to the package root
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const vendor = join(pkgRoot, 'vendor', 'grammars', `${name}.wasm`)
  if (existsSync(vendor)) return vendor

  throw new Error(
    `Cannot locate ${name}.wasm. ` +
    `Run \`pnpm prepare:wasm\` to download grammars, or set TREE_SITTER_WASM_DIR.`,
  )
}

/** Create a fresh Parser instance with the given language loaded. */
export async function createParser(lang: Language): Promise<Parser> {
  await ensureInit()
  const parser = new Parser()
  parser.setLanguage(lang)
  return parser
}
