/**
 * STUB — replaced by analyze-python (py-1) when it lands on develop.
 *
 * This file exists only so that vitest can resolve the import path and apply
 * vi.mock() in test/analyzers/objc/conformance.test.ts. Real tests mock this
 * entire module; no function here runs in tests.
 *
 * TSNode/TSTree/GrammarHandle are also exported here so the Rust analyzer
 * test helper can type the native tree-sitter wrapper without a separate stub.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

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

// ── Runtime stubs (py-1 replaces these) ──────────────────────────────────────

export async function loadGrammar(_name: string): Promise<GrammarHandle> {
  throw new Error('tree-sitter scaffold (py-1) not yet installed — inject a GrammarHandle in tests');
}

export function parseSource(_lang: unknown, _text: string): unknown {
  throw new Error('tree-sitter scaffold (py-1) not yet installed');
}

export function runQuery(
  _tree: unknown,
  _lang: unknown,
  _query: string,
): unknown[] {
  throw new Error('tree-sitter scaffold (py-1) not yet installed');
}
