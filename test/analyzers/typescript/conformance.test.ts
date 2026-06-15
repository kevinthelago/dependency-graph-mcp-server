// ts-6: TS/JS conformance + fixture coverage
import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TypeScriptAnalyzer } from '../../../src/analyzers/typescript/index.js';
import { runConformanceSuite } from '../../conformance/index.js';
import type { ProjectContext, AnalysisFragment } from '../../../src/analyzers/types.js';

function makeCtx(root: string, config: Record<string, unknown> = {}): ProjectContext {
  return { repoRoot: root, config, resolveExternal: () => null };
}

function readFixture(root: string, rel: string): { absPath: string; text: string } {
  const absPath = path.join(root, rel);
  return { absPath, text: fs.readFileSync(absPath, 'utf8') };
}

// ---------------------------------------------------------------------------
// Shared conformance suite runs
// ---------------------------------------------------------------------------

runConformanceSuite(() => new TypeScriptAnalyzer(), [
  {
    root: path.resolve('fixtures/ts/simple'),
    files: [
      readFixture(path.resolve('fixtures/ts/simple'), 'src/utils.ts'),
      readFixture(path.resolve('fixtures/ts/simple'), 'src/main.ts'),
    ],
    hasFileNode: true,
    hasResolvedImport: true,
    checkDeterminism: true,
  },
  {
    root: path.resolve('fixtures/ts/paths-alias'),
    files: [
      readFixture(path.resolve('fixtures/ts/paths-alias'), 'src/lib/format.ts'),
      readFixture(path.resolve('fixtures/ts/paths-alias'), 'src/utils/index.ts'),
      readFixture(path.resolve('fixtures/ts/paths-alias'), 'src/index.ts'),
    ],
    hasFileNode: true,
    hasResolvedImport: true,
    checkDeterminism: true,
  },
  {
    root: path.resolve('fixtures/ts/barrel'),
    files: [
      readFixture(path.resolve('fixtures/ts/barrel'), 'src/a.ts'),
      readFixture(path.resolve('fixtures/ts/barrel'), 'src/b.ts'),
      readFixture(path.resolve('fixtures/ts/barrel'), 'src/index.ts'),
      readFixture(path.resolve('fixtures/ts/barrel'), 'src/consumer.ts'),
    ],
    hasFileNode: true,
    hasResolvedImport: true,
    checkDeterminism: true,
  },
]);

// ---------------------------------------------------------------------------
// TS-specific: JS interop (allowJs)
// ---------------------------------------------------------------------------

describe('JS interop (allowJs)', () => {
  const ROOT = path.resolve('fixtures/ts/js-interop');
  let analyzer: TypeScriptAnalyzer;
  let jsFragment: AnalysisFragment;
  let tsFragment: AnalysisFragment;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(ROOT));

    const helper = readFixture(ROOT, 'src/helper.js');
    const main = readFixture(ROOT, 'src/main.ts');
    jsFragment = await analyzer.analyzeFile(helper.absPath, helper.text);
    tsFragment = await analyzer.analyzeFile(main.absPath, main.text);
  });

  afterAll(() => analyzer.dispose());

  it('JS file node has language js', () => {
    expect(jsFragment.file.language).toBe('js');
  });

  it('TS file imports from JS file (resolved edge)', () => {
    const resolved = tsFragment.edges.filter(
      (e) => e.kind === 'import' && e.resolution === 'resolved',
    );
    expect(resolved.some((e) => e.to.includes('helper'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS-specific: external leaf + unresolved
// ---------------------------------------------------------------------------

describe('external leaf + unresolved', () => {
  const ROOT = path.resolve('fixtures/ts/external');
  let analyzer: TypeScriptAnalyzer;
  let frag: AnalysisFragment;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(ROOT));
    const f = readFixture(ROOT, 'src/main.ts');
    frag = await analyzer.analyzeFile(f.absPath, f.text);
  });

  afterAll(() => analyzer.dispose());

  it('resolved external import uses ext: id', () => {
    // zod is installed as a dep; if resolved, it should be ext:ts:zod
    const extEdges = frag.edges.filter((e) => e.targetType === 'external');
    if (extEdges.some((e) => e.resolution === 'resolved')) {
      expect(extEdges.some((e) => e.to.startsWith('ext:'))).toBe(true);
    }
  });

  it('unresolved import still emits an edge', () => {
    const unresolved = frag.edges.filter((e) => e.resolution === 'unresolved');
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it('unresolved imports are recorded in fragment.imports', () => {
    const unresolved = frag.imports.filter((i) => i.isUnresolved);
    expect(unresolved.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TS-specific: type-only import
// ---------------------------------------------------------------------------

describe('type-only imports', () => {
  const ROOT = path.resolve('fixtures/ts/simple');
  let analyzer: TypeScriptAnalyzer;
  let frag: AnalysisFragment;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(ROOT));
    const mainPath = path.join(ROOT, 'src', 'main.ts');
    // main.ts has `import type { FormatOptions }` from utils.ts
    frag = await analyzer.analyzeFile(mainPath, fs.readFileSync(mainPath, 'utf8'));
  });

  afterAll(() => analyzer.dispose());

  it('type-only import edge has typeOnly flag', () => {
    const typeOnlyEdge = frag.edges.find(
      (e) => e.kind === 'import' && e.typeOnly === true,
    );
    expect(typeOnlyEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TS-specific: incremental snapshot swap (ts-5)
// ---------------------------------------------------------------------------

describe('incremental re-analysis', () => {
  const ROOT = path.resolve('fixtures/ts/simple');
  let analyzer: TypeScriptAnalyzer;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(ROOT));
  });

  afterAll(() => analyzer.dispose());

  it('re-analyzing with updated content yields consistent fragment', async () => {
    const utilsPath = path.join(ROOT, 'src', 'utils.ts');
    const original = fs.readFileSync(utilsPath, 'utf8');

    const frag1 = await analyzer.analyzeFile(utilsPath, original);
    // Swap snapshot with a trivially modified version
    const modified = original + '\n// comment';
    const frag2 = await analyzer.analyzeFile(utilsPath, modified);

    // Symbol count should be unchanged — we only added a comment
    expect(frag2.symbols.length).toBe(frag1.symbols.length);
    expect(frag2.file.id).toBe(frag1.file.id);
  });

  it('result identical to cold parse of same content', async () => {
    const utilsPath = path.join(ROOT, 'src', 'utils.ts');
    const text = fs.readFileSync(utilsPath, 'utf8');

    const frag1 = await analyzer.analyzeFile(utilsPath, text);

    // Cold analyzer
    const cold = new TypeScriptAnalyzer();
    await cold.init(makeCtx(ROOT));
    const frag2 = await cold.analyzeFile(utilsPath, text);
    await cold.dispose();

    expect(frag2.symbols.map((s) => s.id)).toEqual(frag1.symbols.map((s) => s.id));
  });
});
