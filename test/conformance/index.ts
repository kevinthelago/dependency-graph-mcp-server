// Shared conformance suite — every LanguageAnalyzer must pass these assertions.
// NOTE: owned by core stream (core-5); bootstrapped here for use by the TS analyzer.

import { describe, it, expect } from 'vitest';
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext } from '../../src/analyzers/types.js';

export interface ConformanceFixture {
  /** Absolute path to the fixture project root. */
  root: string;
  /** Files to analyze: { absPath, text } */
  files: Array<{ absPath: string; text: string }>;
  /** Expected: at least one file node present. */
  hasFileNode: boolean;
  /** Expected: at least one resolved import edge (if any imports exist). */
  hasResolvedImport?: boolean;
  /** Expected: at least one external leaf import. */
  hasExternalLeaf?: boolean;
  /** Expected: at least one unresolved import. */
  hasUnresolved?: boolean;
  /** Expected: deterministic symbol order (same result on two runs). */
  checkDeterminism?: boolean;
}

export function runConformanceSuite(
  analyzerFactory: () => LanguageAnalyzer,
  fixtures: ConformanceFixture[],
): void {
  for (const fixture of fixtures) {
    describe(`conformance: ${fixture.root}`, () => {
      let analyzer: LanguageAnalyzer;
      let fragments: AnalysisFragment[];

      it('init succeeds', async () => {
        analyzer = analyzerFactory();
        const ctx: ProjectContext = {
          repoRoot: fixture.root,
          config: {},
          resolveExternal: () => null,
        };
        await expect(analyzer.init(ctx)).resolves.toBeUndefined();
      });

      it('analyzeFile returns AnalysisFragment with file node', async () => {
        fragments = [];
        for (const f of fixture.files) {
          const frag = await analyzer.analyzeFile(f.absPath, f.text);
          fragments.push(frag);

          if (fixture.hasFileNode) {
            expect(frag.file).toBeDefined();
            expect(frag.file.kind).toBe('file');
            expect(frag.file.id).toMatch(/^file:/);
          }
        }
      });

      if (fixture.hasResolvedImport) {
        it('has at least one resolved import edge', () => {
          const allEdges = fragments.flatMap((f) => f.edges);
          const resolved = allEdges.filter(
            (e) => e.kind === 'import' && e.resolution === 'resolved',
          );
          expect(resolved.length).toBeGreaterThan(0);
        });
      }

      if (fixture.hasExternalLeaf) {
        it('has at least one external leaf', () => {
          const allEdges = fragments.flatMap((f) => f.edges);
          const external = allEdges.filter((e) => e.targetType === 'external');
          expect(external.length).toBeGreaterThan(0);
          for (const e of external) {
            expect(e.to).toMatch(/^ext:/);
          }
        });
      }

      if (fixture.hasUnresolved) {
        it('has at least one unresolved import', () => {
          const allEdges = fragments.flatMap((f) => f.edges);
          const unresolved = allEdges.filter((e) => e.resolution === 'unresolved');
          expect(unresolved.length).toBeGreaterThan(0);
        });
      }

      if (fixture.checkDeterminism) {
        it('produces deterministic output on re-analysis', async () => {
          const ctx: ProjectContext = {
            repoRoot: fixture.root,
            config: {},
            resolveExternal: () => null,
          };
          const a2 = analyzerFactory();
          await a2.init(ctx);
          for (let i = 0; i < fixture.files.length; i++) {
            const f = fixture.files[i]!;
            const frag2 = await a2.analyzeFile(f.absPath, f.text);
            expect(frag2.symbols.map((s) => s.id)).toEqual(
              fragments[i]!.symbols.map((s) => s.id),
            );
            expect(frag2.edges.map((e) => `${e.from}|${e.to}`)).toEqual(
              fragments[i]!.edges.map((e) => `${e.from}|${e.to}`),
            );
          }
          await a2.dispose();
        });
      }

      it('dispose does not throw', async () => {
        await expect(analyzer.dispose()).resolves.toBeUndefined();
      });
    });
  }
}
