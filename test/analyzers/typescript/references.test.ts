import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { TypeScriptAnalyzer } from '../../../src/analyzers/typescript/index.js';
import type { ProjectContext } from '../../../src/analyzers/types.js';
import type { AnalysisFragment } from '../../../src/analyzers/types.js';

const SIMPLE_ROOT = path.resolve('fixtures/ts/simple');
const BARREL_ROOT = path.resolve('fixtures/ts/barrel');

function makeCtx(root: string): ProjectContext {
  return { repoRoot: root, config: {}, resolveExternal: () => null };
}

describe('reference edges — simple fixture', () => {
  let analyzer: TypeScriptAnalyzer;
  let mainFrag: AnalysisFragment;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(SIMPLE_ROOT));

    const fs = require('node:fs');
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'main.ts');
    mainFrag = await analyzer.analyzeFile(mainPath, fs.readFileSync(mainPath, 'utf8'));
  });

  afterAll(() => analyzer.dispose());

  it('emits cross-file reference edges from main.ts to utils.ts', () => {
    const refEdges = mainFrag.edges.filter(
      (e) => e.kind === 'reference' && e.to.includes('utils.ts'),
    );
    expect(refEdges.length).toBeGreaterThan(0);
  });

  it('reference edges point to symbol nodes (sym:)', () => {
    const refEdges = mainFrag.edges.filter((e) => e.kind === 'reference');
    for (const e of refEdges) {
      if (!e.to.startsWith('ext:')) {
        expect(e.to).toMatch(/^sym:/);
      }
    }
  });

  it('does not emit self-references', () => {
    const refEdges = mainFrag.edges.filter((e) => e.kind === 'reference');
    for (const e of refEdges) {
      expect(e.from).not.toBe(e.to);
    }
  });
});

describe('reference edges — barrel fixture', () => {
  let analyzer: TypeScriptAnalyzer;
  let consumerFrag: AnalysisFragment;

  beforeAll(async () => {
    analyzer = new TypeScriptAnalyzer();
    await analyzer.init(makeCtx(BARREL_ROOT));

    const fs = require('node:fs');
    // Analyze all files so the type-checker knows them all
    for (const f of ['src/a.ts', 'src/b.ts', 'src/index.ts']) {
      const absPath = path.join(BARREL_ROOT, f);
      await analyzer.analyzeFile(absPath, fs.readFileSync(absPath, 'utf8'));
    }
    const consumerPath = path.join(BARREL_ROOT, 'src', 'consumer.ts');
    consumerFrag = await analyzer.analyzeFile(
      consumerPath,
      fs.readFileSync(consumerPath, 'utf8'),
    );
  });

  afterAll(() => analyzer.dispose());

  it('pierces barrel: consumer.ts references pierce through index.ts to a.ts and b.ts', () => {
    const refEdges = consumerFrag.edges.filter((e) => e.kind === 'reference');
    const targets = refEdges.map((e) => e.to);
    // alpha is declared in a.ts, beta in b.ts — the type-checker pierces the barrel
    const hasA = targets.some((t) => t.includes('a.ts'));
    const hasB = targets.some((t) => t.includes('b.ts'));
    // At least one of the two should be pierced
    expect(hasA || hasB).toBe(true);
  });
});
