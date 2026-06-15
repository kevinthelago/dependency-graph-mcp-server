/**
 * Test helpers for the Python analyzer.
 *
 * The real WASM grammar must be present at vendor/grammars/tree-sitter-python.wasm.
 * If it's absent (CI without a prepare:wasm step), tests self-skip.
 */

import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

export const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..',
)
export const FIXTURES = join(ROOT, 'fixtures', 'python')
export const WASM_PATH = join(ROOT, 'vendor', 'grammars', 'tree-sitter-python.wasm')

/** True if the WASM grammar is available; false → tests self-skip. */
export const WASM_AVAILABLE = existsSync(WASM_PATH)

export interface MockExternalRef {
  id: string
}

/** Minimal ProjectContext for tests. */
export function makeContext(repoRoot: string): {
  repoRoot: string
  config: Record<string, unknown>
  resolveExternal(spec: string): MockExternalRef | null
} {
  return {
    repoRoot,
    config: {},
    resolveExternal: (spec) => ({ id: `ext:python:${spec}` }),
  }
}
