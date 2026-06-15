// SCAFFOLD STUB — py-1 (analyze-python stream) owns src/analyzers/tree-sitter/.
// This stub lets the Rust analyzer compile and tests run via grammar injection.
// py-1 will overwrite this with a web-tree-sitter WASM implementation.

export interface TSPosition {
  row: number
  column: number
}

export interface TSNode {
  readonly type: string
  readonly text: string
  readonly isNamed: boolean
  readonly startPosition: TSPosition
  readonly endPosition: TSPosition
  readonly children: readonly TSNode[]
  readonly namedChildren: readonly TSNode[]
  readonly childCount: number
  readonly namedChildCount: number
  childForFieldName(name: string): TSNode | null
}

export interface TSTree {
  readonly rootNode: TSNode
}

export interface GrammarHandle {
  parse(text: string): TSTree
}

export type ResolverResult =
  | { kind: 'file'; path: string }
  | { kind: 'external'; spec: string }

/** Each language plugs its module-resolution logic into this hook. */
export type ResolverHook = (
  spec: string,
  fromFile: string,
  repoRoot: string,
) => ResolverResult | null

/** Loads a WASM grammar by language id. Provided by py-1 at runtime. */
export async function loadGrammar(_languageId: string): Promise<GrammarHandle> {
  throw new Error('tree-sitter scaffold (py-1) not yet installed — inject a GrammarHandle in tests')
}
