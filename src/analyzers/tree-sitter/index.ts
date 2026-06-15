/**
 * Tree-sitter scaffold — public API.
 *
 * Exports the WASM-based grammar loader and query runner (py-1 implementation),
 * plus the TSNode/TSTree/GrammarHandle type stubs used by Rust/C++ test helpers.
 */

// ── WASM scaffold (py-1) ──────────────────────────────────────────────────────
export { loadGrammar, resolveGrammarPath, createParser } from './loader.js'
export { QueryRunner } from './query-runner.js'
export type { CaptureResult, PatternMatch } from './query-runner.js'
export type { ResolverHook, ResolveResult } from './resolver-hook.js'

// ── Types for native grammar adapters used in tests ──────────────────────────

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
