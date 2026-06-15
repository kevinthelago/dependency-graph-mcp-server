// Creates a GrammarHandle backed by native tree-sitter for use in tests.
// Production code uses web-tree-sitter via the py-1 scaffold.

import { createRequire } from 'node:module'
import type { GrammarHandle, TSTree } from '../../src/analyzers/tree-sitter/index.js'

const require = createRequire(import.meta.url)

let grammarHandle: GrammarHandle | null = null

export async function getRustGrammarHandle(): Promise<GrammarHandle> {
  if (grammarHandle != null) return grammarHandle

  // Dynamic require for native CJS modules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Parser = require('tree-sitter') as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RustGrammar = require('tree-sitter-rust') as any

  const parser = new Parser()
  parser.setLanguage(RustGrammar)

  grammarHandle = {
    parse(text: string): TSTree {
      // tree-sitter native's SyntaxNode is structurally compatible with TSNode
      return parser.parse(text) as TSTree
    },
  }

  return grammarHandle
}
