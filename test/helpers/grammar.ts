// GrammarHandle backed by web-tree-sitter (WASM) for use in tests.
// Uses tree-sitter-rust.wasm shipped with tree-sitter-rust@^0.24.0.
// Tests self-skip when the WASM file is absent.

import { Parser, Language } from 'web-tree-sitter'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { GrammarParser, ParsedTree } from '../../src/analyzers/tree-sitter/index.js'

const _require = createRequire(import.meta.url)

let initialized = false
let grammarHandle: GrammarParser | null = null

function getRustWasmPath(): string | null {
  try {
    const pkgJson = _require.resolve('tree-sitter-rust/package.json')
    const wasmPath = join(dirname(pkgJson), 'tree-sitter-rust.wasm')
    return existsSync(wasmPath) ? wasmPath : null
  } catch {
    return null
  }
}

function getWebTreeSitterWasmPath(): string {
  const entryPath = _require.resolve('web-tree-sitter')
  return join(dirname(entryPath), 'web-tree-sitter.wasm')
}

async function ensureInit(): Promise<void> {
  if (initialized) return
  const wasmPath = getWebTreeSitterWasmPath()
  await Parser.init({ locateFile: () => wasmPath })
  initialized = true
}

export const RUST_WASM_AVAILABLE = getRustWasmPath() !== null

export async function getRustGrammarHandle(): Promise<GrammarParser> {
  if (grammarHandle != null) return grammarHandle

  const wasmPath = getRustWasmPath()
  if (!wasmPath) {
    throw new Error(
      'tree-sitter-rust.wasm not found — ensure tree-sitter-rust@^0.24.0 is installed',
    )
  }

  await ensureInit()
  const lang = await Language.load(wasmPath)
  const parser = new Parser()
  parser.setLanguage(lang)

  grammarHandle = {
    parse(text: string): ParsedTree {
      const tree = parser.parse(text)
      if (!tree) throw new Error('web-tree-sitter parse returned null for Rust source')
      return tree as unknown as ParsedTree
    },
  }

  return grammarHandle
}
