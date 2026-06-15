/**
 * STUB — replaced by analyze-python (py-1) when it lands on develop.
 *
 * This file exists only so that vitest can resolve the import path and apply
 * vi.mock() in test/analyzers/objc/conformance.test.ts. Real tests mock this
 * entire module; no function here runs in tests.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

export async function loadGrammar(_name: string): Promise<unknown> {
  throw new Error('tree-sitter scaffold (py-1) not yet installed');
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
