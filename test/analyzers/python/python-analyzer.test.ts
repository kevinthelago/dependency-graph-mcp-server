/**
 * Python analyzer conformance + language-specific tests (py-4).
 *
 * Covers:
 *   - File node id / kind / language / name
 *   - Top-level symbol extraction (function, class, variable)
 *   - Absolute import resolution → file edge
 *   - Absolute import to stdlib/third-party → external leaf edge
 *   - Relative import resolution (., .., submodule)
 *   - Wildcard import → edge with wildcard:true
 *   - Unresolved import → edge with resolution:"unresolved"
 *   - Deterministic ordering
 *   - analyzeFile is pure (same inputs → same output)
 *
 * Tests self-skip when tree-sitter-python.wasm is absent (run pnpm prepare:wasm).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PythonAnalyzer } from '../../../src/analyzers/python/index.js'
import {
  FIXTURES,
  WASM_PATH,
  WASM_AVAILABLE,
  makeContext,
} from './helpers.js'

const skip = !WASM_AVAILABLE

describe('PythonAnalyzer', () => {
  let analyzer: PythonAnalyzer

  beforeAll(async () => {
    if (skip) return
    analyzer = new PythonAnalyzer({ wasmPath: WASM_PATH })
    await analyzer.init(makeContext(FIXTURES))
  })

  afterAll(async () => {
    if (skip) return
    await analyzer.dispose()
  })

  // ── Conformance: file node ────────────────────────────────────────────────

  it.skipIf(skip)('file node has correct id, kind, language, name', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    expect(frag.file.id).toBe('file:main.py')
    expect(frag.file.kind).toBe('file')
    expect(frag.file.language).toBe('python')
    expect(frag.file.name).toBe('main.py')
  })

  // ── Conformance: symbol nodes ─────────────────────────────────────────────

  it.skipIf(skip)('extracts top-level function symbol', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    const run = frag.symbols.find((s) => s.name === 'run')
    expect(run).toBeDefined()
    expect(run!.kind).toBe('symbol')
    expect(run!.symbolKind).toBe('function')
    expect(run!.file).toBe('main.py')
    expect(run!.id).toMatch(/^sym:main\.py#run/)
  })

  it.skipIf(skip)('extracts top-level class symbol', async () => {
    const text = readFileSync(join(FIXTURES, 'pkg', 'models.py'), 'utf8')
    const frag = await analyzer.analyzeFile('pkg/models.py', text)

    const user = frag.symbols.find((s) => s.name === 'User')
    expect(user).toBeDefined()
    expect(user!.symbolKind).toBe('class')

    const role = frag.symbols.find((s) => s.name === 'Role')
    expect(role).toBeDefined()
    expect(role!.symbolKind).toBe('class')
  })

  it.skipIf(skip)('extracts top-level variable from annotated assignment', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    const greeting = frag.symbols.find((s) => s.name === 'GREETING')
    expect(greeting).toBeDefined()
    expect(greeting!.symbolKind).toBe('variable')
  })

  // ── Conformance: import edges ─────────────────────────────────────────────

  it.skipIf(skip)('resolves absolute package import → file edge', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    // `from pkg import User, Role, greet` → resolves to pkg/__init__.py
    const pkgEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.to === 'file:pkg/__init__.py',
    )
    expect(pkgEdge).toBeDefined()
    expect(pkgEdge!.resolution).toBe('resolved')
    expect(pkgEdge!.targetType).toBe('file')
  })

  it.skipIf(skip)('resolves dotted absolute import → file edge', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    // `from pkg.models import User as UserAlias`
    const modelsEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.to === 'file:pkg/models.py',
    )
    expect(modelsEdge).toBeDefined()
    expect(modelsEdge!.resolution).toBe('resolved')
  })

  it.skipIf(skip)('marks stdlib import as external leaf', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    // `import os` → external
    const osEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.to === 'ext:os',
    )
    expect(osEdge).toBeDefined()
    expect(osEdge!.targetType).toBe('external')
    expect(osEdge!.resolution).toBe('resolved')
  })

  it.skipIf(skip)('wildcard import has wildcard:true on edge', async () => {
    const text = readFileSync(join(FIXTURES, 'wildcard.py'), 'utf8')
    const frag = await analyzer.analyzeFile('wildcard.py', text)

    const wildcardEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.wildcard === true,
    )
    expect(wildcardEdge).toBeDefined()
  })

  it.skipIf(skip)('wildcard from stdlib is external with wildcard:true', async () => {
    const text = readFileSync(join(FIXTURES, 'wildcard.py'), 'utf8')
    const frag = await analyzer.analyzeFile('wildcard.py', text)

    const extWild = frag.edges.find(
      (e) =>
        e.kind === 'import' &&
        e.wildcard === true &&
        e.targetType === 'external',
    )
    expect(extWild).toBeDefined()
  })

  // ── Conformance: unresolved imports ───────────────────────────────────────

  it.skipIf(skip)('unresolved import gets resolution:unresolved edge', async () => {
    const text = `import nonexistent_package\nfrom another_missing import thing`
    const frag = await analyzer.analyzeFile('some_file.py', text)

    void frag.edges.filter((e) => e.resolution === 'unresolved')
    // Both imports should be external (stdlib heuristic), not unresolved
    // But for something that can't be resolved and isn't in source roots,
    // we emit external. Let's test with a relative import that fails:
    const text2 = `from .nonexistent import thing`
    const frag2 = await analyzer.analyzeFile('orphan.py', text2)
    const unres2 = frag2.edges.filter((e) => e.resolution === 'unresolved')
    expect(unres2.length).toBeGreaterThan(0)
  })

  // ── Relative imports ──────────────────────────────────────────────────────

  it.skipIf(skip)('resolves relative import (from . import name)', async () => {
    const text = readFileSync(join(FIXTURES, 'pkg', '__init__.py'), 'utf8')
    const frag = await analyzer.analyzeFile('pkg/__init__.py', text)

    // `from .models import User, Role` → pkg/models.py
    const modelsEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.to === 'file:pkg/models.py',
    )
    expect(modelsEdge).toBeDefined()
    expect(modelsEdge!.resolution).toBe('resolved')
  })

  it.skipIf(skip)('resolves relative import (from .sibling import name)', async () => {
    const text = readFileSync(join(FIXTURES, 'sub', 'child.py'), 'utf8')
    const frag = await analyzer.analyzeFile('sub/child.py', text)

    const siblingEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.to === 'file:sub/sibling.py',
    )
    expect(siblingEdge).toBeDefined()
    expect(siblingEdge!.resolution).toBe('resolved')
  })

  // ── Conformance: ImportRefs ───────────────────────────────────────────────

  it.skipIf(skip)('importRefs carry resolvedPath for project files', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const frag = await analyzer.analyzeFile('main.py', text)

    const pkgRef = frag.imports.find(
      (r) => r.resolvedPath === 'pkg/__init__.py' || r.resolvedPath?.startsWith('pkg/'),
    )
    expect(pkgRef).toBeDefined()
    expect(pkgRef!.isExternal).toBe(false)
    expect(pkgRef!.isUnresolved).toBe(false)
  })

  it.skipIf(skip)('importRefs mark external packages', async () => {
    const text = readFileSync(join(FIXTURES, 'external.py'), 'utf8')
    const frag = await analyzer.analyzeFile('external.py', text)

    const reqRef = frag.imports.find((r) => r.specifier === 'requests')
    expect(reqRef).toBeDefined()
    expect(reqRef!.isExternal).toBe(true)
  })

  // ── Purity / determinism ──────────────────────────────────────────────────

  it.skipIf(skip)('analyzeFile is pure — same inputs produce identical output', async () => {
    const text = readFileSync(join(FIXTURES, 'main.py'), 'utf8')
    const a = await analyzer.analyzeFile('main.py', text)
    const b = await analyzer.analyzeFile('main.py', text)

    expect(a.file).toEqual(b.file)
    expect(a.symbols).toEqual(b.symbols)
    expect(a.edges).toEqual(b.edges)
    expect(a.imports).toEqual(b.imports)
  })

  it.skipIf(skip)('symbol order is deterministic (document order)', async () => {
    const text = readFileSync(join(FIXTURES, 'pkg', 'models.py'), 'utf8')
    const frag = await analyzer.analyzeFile('pkg/models.py', text)
    const names = frag.symbols.map((s) => s.name)
    // Role appears before User in models.py
    expect(names.indexOf('Role')).toBeLessThan(names.indexOf('User'))
  })

  // ── External file test (no WASM required) ─────────────────────────────────

  it('WASM_AVAILABLE flag is exported (smoke)', () => {
    // Just verifies the helper exports work without WASM
    expect(typeof WASM_AVAILABLE).toBe('boolean')
  })
})

// ── Source-root config tests (no WASM required) ─────────────────────────────

describe('resolveSourceRoots', () => {
  it('uses repo root as fallback when no config is present', async () => {
    const { resolveSourceRoots } = await import('../../../src/analyzers/python/config.js')
    const roots = resolveSourceRoots('/some/path', {})
    expect(roots).toEqual(['/some/path'])
  })

  it('uses explicit sourceRoots from config', async () => {
    const { resolveSourceRoots } = await import('../../../src/analyzers/python/config.js')
    const { resolve } = await import('path')
    const roots = resolveSourceRoots('/repo', { sourceRoots: ['src', 'lib'] })
    expect(roots).toContain(resolve('/repo', 'src'))
    expect(roots).toContain(resolve('/repo', 'lib'))
  })
})

// ── Import resolution unit tests (no WASM required) ─────────────────────────

describe('resolveRelative', () => {
  it('resolves level=1 submodule from a nested file', async () => {
    const { resolveRelative } = await import('../../../src/analyzers/python/imports.js')
    // from .sibling import helper  (in sub/child.py → sub/sibling.py)
    const result = resolveRelative(1, 'sibling', 'sub/child.py', FIXTURES)
    expect(result).toBe('sub/sibling.py')
  })

  it('returns null for a non-existent relative target', async () => {
    const { resolveRelative } = await import('../../../src/analyzers/python/imports.js')
    const result = resolveRelative(1, 'nonexistent', 'sub/child.py', FIXTURES)
    expect(result).toBeNull()
  })
})

describe('parseRelativeModule', () => {
  it('parses single dot', async () => {
    const { parseRelativeModule } = await import('../../../src/analyzers/python/imports.js')
    expect(parseRelativeModule('.')).toEqual({ level: 1, submodule: null })
  })

  it('parses double dot with submodule', async () => {
    const { parseRelativeModule } = await import('../../../src/analyzers/python/imports.js')
    expect(parseRelativeModule('..pkg')).toEqual({ level: 2, submodule: 'pkg' })
  })
})
