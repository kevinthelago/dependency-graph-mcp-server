// STUB — core-5 (core stream) owns test/conformance/.
// Minimal shared conformance assertions used by the Rust analyzer tests
// until the real harness lands on develop.

import { expect } from 'vitest'
import type { AnalysisFragment } from '../../src/analyzers/types.js'

/** Assert the basic conformance requirements every analyzer must satisfy. */
export function assertConformance(fragment: AnalysisFragment, filePath: string): void {
  // File node present with correct id
  expect(fragment.file.id).toBe(`file:${filePath}`)
  expect(fragment.file.kind).toBe('file')
  expect(fragment.file.language).toBe('rust')
  expect(fragment.file.name).toBe(filePath)

  // All symbol nodes reference the file
  for (const sym of fragment.symbols) {
    if (sym.kind === 'symbol') {
      expect(sym.file).toBe(filePath)
      expect(sym.language).toBe('rust')
      expect(sym.symbolKind).toBeTruthy()
    }
  }

  // All edges originate from the file
  for (const edge of fragment.edges) {
    expect(edge.from).toBe(`file:${filePath}`)
    expect(edge.resolution).toMatch(/^(resolved|unresolved)$/)
    expect(edge.kind).toMatch(/^(import|reference)$/)
    expect(edge.targetType).toMatch(/^(file|symbol|external)$/)
  }

  // Determinism: run again with same input, expect same result (caller verifies)
}

/** Assert that external nodes are present for unresolved/external imports. */
export function assertExternalLeaves(
  fragment: AnalysisFragment,
  expectedSpecs: string[],
): void {
  const extIds = new Set(
    fragment.edges
      .filter((e) => e.targetType === 'external')
      .map((e) => e.to),
  )
  for (const spec of expectedSpecs) {
    const id = `ext:rust:${spec}`
    expect(extIds.has(id), `expected external leaf ${id}`).toBe(true)
  }
}

/** Assert that unresolved imports are not dropped. */
export function assertUnresolvedNotDropped(
  fragment: AnalysisFragment,
  minCount: number,
): void {
  const unresolved = fragment.edges.filter((e) => e.resolution === 'unresolved')
  expect(unresolved.length).toBeGreaterThanOrEqual(minCount)
}
