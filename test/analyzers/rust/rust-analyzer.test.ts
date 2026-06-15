import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RustAnalyzer } from '../../../src/analyzers/rust/index.js'
import type { ProjectContext } from '../../../src/analyzers/types.js'
import { getRustGrammarHandle } from '../../helpers/grammar.js'
import {
  assertConformance,
  assertExternalLeaves,
  assertUnresolvedNotDropped,
} from '../../conformance/shared-suite.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname, '../../../fixtures/rust')

// Skip the entire suite when native tree-sitter isn't built for this platform.
const _req = createRequire(import.meta.url)
let _nativeAvailable = false
try { _req('tree-sitter'); _nativeAvailable = true } catch { /* no native build */ }

function fixtureCtx(fixture: string): ProjectContext {
  return {
    repoRoot: path.join(FIXTURES, fixture),
    config: {},
    resolveExternal: () => null,
  }
}

function readFixture(fixture: string, ...parts: string[]): string {
  return readFileSync(path.join(FIXTURES, fixture, ...parts), 'utf-8')
}

describe.skipIf(!_nativeAvailable)('RustAnalyzer', () => {
  let analyzer: RustAnalyzer

  beforeAll(async () => {
    const grammar = await getRustGrammarHandle()
    analyzer = new RustAnalyzer(() => Promise.resolve(grammar!))
  })

  // -------------------------------------------------------------------------
  // simple fixture: top-level symbols
  // -------------------------------------------------------------------------
  describe('simple fixture — top-level items', () => {
    let fragment: Awaited<ReturnType<RustAnalyzer['analyzeFile']>>
    const filePath = 'src/lib.rs'

    beforeAll(async () => {
      const ctx = fixtureCtx('simple')
      await analyzer.init(ctx)
      const text = readFixture('simple', 'src', 'lib.rs')
      fragment = await analyzer.analyzeFile(filePath, text)
    })

    it('passes shared conformance', () => {
      assertConformance(fragment, filePath)
    })

    it('emits a file node', () => {
      expect(fragment.file.id).toBe('file:src/lib.rs')
      expect(fragment.file.kind).toBe('file')
      expect(fragment.file.language).toBe('rust')
    })

    it('extracts struct', () => {
      const sym = fragment.symbols.find((s) => s.name === 'Config')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('struct')
      expect(sym?.exported).toBe(true)
    })

    it('extracts function', () => {
      const sym = fragment.symbols.find((s) => s.name === 'create_config')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('function')
      expect(sym?.exported).toBe(true)
    })

    it('extracts enum', () => {
      const sym = fragment.symbols.find((s) => s.name === 'Status')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('enum')
    })

    it('extracts trait', () => {
      const sym = fragment.symbols.find((s) => s.name === 'Describable')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('trait')
    })

    it('extracts type alias', () => {
      const sym = fragment.symbols.find((s) => s.name === 'Alias')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('type')
    })

    it('extracts const', () => {
      const sym = fragment.symbols.find((s) => s.name === 'MAX_SIZE')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('variable')
    })

    it('extracts static', () => {
      const sym = fragment.symbols.find((s) => s.name === 'GLOBAL_NAME')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('variable')
    })

    it('extracts macro_rules!', () => {
      const sym = fragment.symbols.find((s) => s.name === 'make_it')
      expect(sym).toBeDefined()
      expect(sym?.symbolKind).toBe('macro')
    })

    it('emits external leaf for std', () => {
      assertExternalLeaves(fragment, ['std::collections::HashMap'])
    })

    it('emits external leaf for serde', () => {
      assertExternalLeaves(fragment, ['serde::Serialize'])
    })

    it('deterministic: two runs produce identical output', async () => {
      const ctx = fixtureCtx('simple')
      await analyzer.init(ctx)
      const text = readFixture('simple', 'src', 'lib.rs')
      const fragment2 = await analyzer.analyzeFile(filePath, text)
      expect(fragment2).toEqual(fragment)
    })
  })

  // -------------------------------------------------------------------------
  // mods fixture: mod declarations
  // -------------------------------------------------------------------------
  describe('mods fixture — mod resolution', () => {
    let fragment: Awaited<ReturnType<RustAnalyzer['analyzeFile']>>
    const filePath = 'src/lib.rs'

    beforeAll(async () => {
      const ctx = fixtureCtx('mods')
      await analyzer.init(ctx)
      const text = readFixture('mods', 'src', 'lib.rs')
      fragment = await analyzer.analyzeFile(filePath, text)
    })

    it('passes shared conformance', () => {
      assertConformance(fragment, filePath)
    })

    it('resolves `mod utils;` to src/utils.rs', () => {
      const edge = fragment.edges.find(
        (e) => e.to === 'file:src/utils.rs' && e.kind === 'import',
      )
      expect(edge).toBeDefined()
      expect(edge?.resolution).toBe('resolved')
    })

    it('emits inline mod helpers as a symbol node', () => {
      const sym = fragment.symbols.find((s) => s.name === 'helpers' && s.symbolKind === 'module')
      expect(sym).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // use-paths fixture: crate/super/self/external paths
  // -------------------------------------------------------------------------
  describe('use-paths fixture — use path resolution', () => {
    let lib: Awaited<ReturnType<RustAnalyzer['analyzeFile']>>
    let inner: Awaited<ReturnType<RustAnalyzer['analyzeFile']>>

    beforeAll(async () => {
      const ctx = fixtureCtx('use-paths')
      await analyzer.init(ctx)
      lib = await analyzer.analyzeFile('src/lib.rs', readFixture('use-paths', 'src', 'lib.rs'))
      inner = await analyzer.analyzeFile('src/inner.rs', readFixture('use-paths', 'src', 'inner.rs'))
    })

    it('lib.rs: resolves std::io::Read as external', () => {
      assertExternalLeaves(lib, ['std::io::Read'])
    })

    it('lib.rs: resolves grouped std imports as externals', () => {
      assertExternalLeaves(lib, ['std::collections::HashMap', 'std::collections::HashSet'])
    })

    it('lib.rs: resolves tokio as external', () => {
      assertExternalLeaves(lib, ['tokio::runtime::Runtime'])
    })

    it('lib.rs: resolves serde group as externals', () => {
      assertExternalLeaves(lib, ['serde::Serialize', 'serde::Deserialize'])
    })

    it('lib.rs: wildcard use std::fmt::* emits wildcard edge', () => {
      const edge = lib.edges.find(
        (e) => e.to.startsWith('ext:rust:std::fmt') && e.wildcard === true,
      )
      expect(edge).toBeDefined()
    })

    it('lib.rs: crate::inner resolved to src/inner.rs', () => {
      const edge = lib.edges.find(
        (e) => e.to === 'file:src/inner.rs' && e.resolution === 'resolved',
      )
      expect(edge).toBeDefined()
    })

    it('inner.rs: `use super::Outer` is unresolved or resolved', () => {
      // super:: points to src/lib.rs; Outer is a struct defined there.
      // We accept either resolved-to-file or unresolved (best-effort).
      const edge = inner.edges.find((e) => e.kind === 'import')
      expect(edge).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // reexports fixture: pub use re-exports + wildcard
  // -------------------------------------------------------------------------
  describe('reexports fixture — pub use and wildcard', () => {
    let fragment: Awaited<ReturnType<RustAnalyzer['analyzeFile']>>
    const filePath = 'src/lib.rs'

    beforeAll(async () => {
      const ctx = fixtureCtx('reexports')
      await analyzer.init(ctx)
      const text = readFixture('reexports', 'src', 'lib.rs')
      fragment = await analyzer.analyzeFile(filePath, text)
    })

    it('passes shared conformance', () => {
      assertConformance(fragment, filePath)
    })

    it('resolves mod inner; to src/inner.rs', () => {
      const edge = fragment.edges.find(
        (e) => e.to === 'file:src/inner.rs' && e.kind === 'import',
      )
      expect(edge).toBeDefined()
    })

    it('wildcard pub use inner::* emits a wildcard edge', () => {
      // `pub use inner::*` after `mod inner;` — inner is resolved via crate path
      const edge = fragment.edges.find((e) => e.wildcard === true && e.kind === 'import')
      expect(edge).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Conformance: unresolved imports are never dropped
  // -------------------------------------------------------------------------
  describe('conformance — unresolved not dropped', () => {
    it('emits unresolved edge for a missing mod', async () => {
      const ctx = fixtureCtx('simple')
      await analyzer.init(ctx)
      // Inline source with a mod decl that won't resolve
      const source = 'mod missing_module;\npub fn foo() {}'
      const frag = await analyzer.analyzeFile('src/lib.rs', source)
      assertUnresolvedNotDropped(frag, 1)
    })
  })
})
