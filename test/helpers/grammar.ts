// Creates a GrammarHandle backed by native tree-sitter for use in tests.
// Production code uses web-tree-sitter via the py-1 scaffold.

import { createRequire } from 'node:module'
import type { GrammarParser, ParsedTree } from '../../src/analyzers/tree-sitter/index.js'

const require = createRequire(import.meta.url)

let grammarHandle: GrammarParser | null = null
let loadAttempted = false

/**
 * Returns a native tree-sitter grammar handle, or null when the native binary
 * is unavailable (e.g. no prebuilt for this platform/Node ABI). Callers should
 * skip tests when this returns null rather than failing.
 */
export async function getRustGrammarHandle(): Promise<GrammarParser | null> {
  if (loadAttempted) return grammarHandle
  loadAttempted = true

  try {
    // Dynamic require for native CJS modules
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Parser = require('tree-sitter') as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const RustGrammar = require('tree-sitter-rust') as any

    const parser = new Parser()
    parser.setLanguage(RustGrammar)

    grammarHandle = {
      parse(text: string): ParsedTree {
        // tree-sitter native's SyntaxNode is structurally compatible with TreeNode
        return parser.parse(text) as unknown as ParsedTree
      },
    }
  } catch {
    // Native binary not available for this platform/Node ABI — callers skip.
    grammarHandle = null
  }

  return grammarHandle
}
