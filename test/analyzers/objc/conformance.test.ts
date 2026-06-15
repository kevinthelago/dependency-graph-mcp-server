/**
 * Shared conformance tests for the Obj-C analyzer (objc-2).
 *
 * These tests verify the contract requirements from contracts/language-analyzer.md:
 *   - analyzeFile returns an AnalysisFragment with the right shapes
 *   - file node is present and correct
 *   - import edges include external leaf for @import / angled includes
 *   - unresolved imports are recorded (not dropped)
 *   - output is deterministic
 *
 * The tree-sitter scaffold and IncludeResolver are mocked via vi.mock so tests
 * run independently of those dependencies landing on develop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock factories so the variable is in scope.
const { mockMatches } = vi.hoisted(() => ({ mockMatches: vi.fn().mockReturnValue([]) }));

// --- Mock py-1 tree-sitter loader (loadGrammar, resolveGrammarPath, createParser) ---
vi.mock('../../../src/analyzers/tree-sitter/loader.js', () => ({
  loadGrammar: vi.fn().mockResolvedValue({ _lang: 'objc' }),
  resolveGrammarPath: vi.fn().mockReturnValue('/mock/tree-sitter-objc.wasm'),
  createParser: vi.fn().mockResolvedValue({ parse: vi.fn().mockReturnValue({ rootNode: {} }) }),
}));

// --- Mock py-1 tree-sitter query runner (QueryRunner) ---
// Must use function (not arrow) so the mock is constructable via `new QueryRunner(...)`.
vi.mock('../../../src/analyzers/tree-sitter/query-runner.js', () => ({
  QueryRunner: vi.fn().mockImplementation(function () { return { matches: mockMatches }; }),
}));

// --- Mock cpp-1 (include resolver) ---
vi.mock('../../../src/analyzers/cpp/resolver.js', () => {
  class MockIncludeResolver {
    resolve(_spec: string, _from: string, _quoted: boolean) {
      return null;
    }
  }
  return { IncludeResolver: MockIncludeResolver };
});

import ObjcAnalyzer from '../../../src/analyzers/objc/index.js';
import type { CaptureResult } from '../../../src/analyzers/objc/types.js';
import { cap } from './helpers.js';

/**
 * setCaptures controls what each successive call to queryRunner.matches() returns.
 * byQuery maps call-index → CaptureResult[]. The CaptureResult[] are wrapped into
 * the PatternMatch[] shape that QueryRunner.matches() actually returns.
 */
function setCaptures(byQuery: Record<number, CaptureResult[]>) {
  let callIdx = 0;
  mockMatches.mockImplementation((_query: string, _tree: unknown) => {
    const captures = byQuery[callIdx] ?? [];
    callIdx++;
    // Wrap each CaptureResult into a single-capture PatternMatch
    return captures.map((c) => ({
      patternIndex: 0,
      captures: [{ name: c.name, node: { text: c.text, startPosition: c.startPosition } }],
    }));
  });
}

const PROJECT_CTX = {
  repoRoot: '/repo',
  config: {},
  resolveExternal: () => null,
};

describe('ObjcAnalyzer conformance', () => {
  let analyzer: ObjcAnalyzer;

  beforeEach(async () => {
    mockMatches.mockReset();
    mockMatches.mockReturnValue([]);
    analyzer = new ObjcAnalyzer();
    await analyzer.init(PROJECT_CTX as any);
  });

  it('analyzeFile returns an AnalysisFragment with a file node', async () => {
    setCaptures({});
    const frag = await analyzer.analyzeFile('fixtures/objc/Animal.h', '');
    expect(frag.file).toBeDefined();
    expect(frag.file.id).toBe('file:fixtures/objc/Animal.h');
    expect(frag.file.kind).toBe('file');
    expect(frag.file.language).toBe('objc');
    expect(frag.file.name).toBe('fixtures/objc/Animal.h');
  });

  it('analyzeFile returns arrays for symbols and edges (may be empty)', async () => {
    setCaptures({});
    const frag = await analyzer.analyzeFile('fixtures/objc/Empty.h', '');
    expect(Array.isArray(frag.symbols)).toBe(true);
    expect(Array.isArray(frag.edges)).toBe(true);
  });

  it('@import creates an external leaf node edge', async () => {
    // Query 0 = IMPORT_QUERY; queries 1,2,3 = SYMBOL, FWD, IMPL
    setCaptures({
      0: [cap('framework-import', 'Foundation', 0)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Habitat.h', '');
    const importEdge = frag.edges.find((e) => e.kind === 'import');
    expect(importEdge).toBeDefined();
    expect(importEdge!.to).toBe('ext:objc:Foundation');
    expect(importEdge!.targetType).toBe('external');
  });

  it('unresolved imports are recorded, not dropped', async () => {
    setCaptures({
      0: [cap('quoted-import', '"missing.h"', 1)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Foo.h', '');
    const unresolvedEdge = frag.edges.find((e) => e.resolution === 'unresolved');
    expect(unresolvedEdge).toBeDefined();
    expect(unresolvedEdge!.to).toContain('missing.h');
  });

  it('@interface emits a class symbol node', async () => {
    setCaptures({
      // IMPORT_QUERY → 0 captures; SYMBOL_QUERY → interface capture
      1: [cap('interface', 'Animal', 10)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Animal.h', '');
    const sym = frag.symbols.find((s) => s.name === 'Animal');
    expect(sym).toBeDefined();
    expect(sym!.symbolKind).toBe('class');
    expect(sym!.id).toBe('sym:fixtures/objc/Animal.h#Animal');
  });

  it('@protocol emits a protocol symbol node', async () => {
    setCaptures({
      1: [cap('protocol', 'Locomotion', 5)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Animal.h', '');
    const sym = frag.symbols.find((s) => s.name === 'Locomotion');
    expect(sym!.symbolKind).toBe('protocol');
  });

  it('#define emits a macro symbol node', async () => {
    setCaptures({
      1: [cap('macro', 'ANIMAL_MAX_LEGS', 3)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Animal.h', '');
    const sym = frag.symbols.find((s) => s.name === 'ANIMAL_MAX_LEGS');
    expect(sym!.symbolKind).toBe('macro');
  });

  it('category @interface emits category symbol + category→class edge', async () => {
    // SYMBOL_QUERY is call index 1 (after IMPORT_QUERY=0)
    setCaptures({
      1: [cap('cat-class', 'Animal', 0), cap('cat-name', 'Training', 0)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Animal+Training.h', '');
    const sym = frag.symbols.find((s) => s.name === 'Animal(Training)');
    expect(sym).toBeDefined();
    expect(sym!.symbolKind).toBe('class');
    const catEdge = frag.edges.find(
      (e) => e.kind === 'reference' && e.to === 'sym:?#Animal',
    );
    expect(catEdge).toBeDefined();
  });

  it('@class forward declaration emits unresolved reference edge', async () => {
    setCaptures({
      2: [cap('forward-class', 'Animal', 4)],
    });
    const frag = await analyzer.analyzeFile('fixtures/objc/Habitat.h', '');
    const fwdEdge = frag.edges.find(
      (e) => e.kind === 'reference' && e.to === 'sym:?#Animal',
    );
    expect(fwdEdge).toBeDefined();
    expect(fwdEdge!.from).toBe('file:fixtures/objc/Habitat.h');
  });

  it('output is deterministic: same inputs produce identical fragment', async () => {
    const caps0: CaptureResult[] = [
      cap('framework-import', 'UIKit', 1),
      cap('framework-import', 'Foundation', 0),
    ];
    setCaptures({ 0: caps0 });
    const frag1 = await analyzer.analyzeFile('fixtures/objc/A.h', '');

    setCaptures({ 0: caps0 });
    const frag2 = await analyzer.analyzeFile('fixtures/objc/A.h', '');

    expect(frag1.edges.map((e) => e.to)).toEqual(frag2.edges.map((e) => e.to));
  });

  it('.mm extension is analyzed as objc language', async () => {
    setCaptures({});
    const frag = await analyzer.analyzeFile('fixtures/objc/MixedImpl.mm', '');
    expect(frag.file.language).toBe('objc');
  });

  it('analyzer never throws on empty input', async () => {
    setCaptures({});
    await expect(analyzer.analyzeFile('empty.m', '')).resolves.toBeDefined();
  });

  it('analyzer id and extensions are correct', () => {
    expect(analyzer.id).toBe('objc');
    expect(analyzer.extensions).toContain('.m');
    expect(analyzer.extensions).toContain('.mm');
    expect(analyzer.extensions).toContain('.h');
  });
});
