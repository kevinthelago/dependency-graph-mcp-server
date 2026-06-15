/**
 * Shared conformance harness — core-6 (issue #6).
 *
 * Every LanguageAnalyzer implementation must pass these assertions.
 * Import and call `runConformanceSuite(analyzer, fixtures)` in your language-
 * specific conformance test.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { LanguageAnalyzer, ProjectContext } from '../../src/analyzers/types.js';

export interface ConformanceFixture {
  /** Absolute path of the file being analysed. */
  filePath: string;
  /** File content. */
  content: string;
  /** Project root for this fixture. */
  ctx: { repoRoot: string };
  /** Expected file node id (e.g. "file:/path/to/file.c"). */
  expectedFileId: string;
  /** At least these symbol names must appear in the output. */
  expectedSymbols?: string[];
  /** At least these external node ids must appear (e.g. "ext:stdio.h"). */
  expectedExternalIncludes?: string[];
  /** At least one in-project resolved import edge must exist. */
  expectsInProjectImport?: boolean;
}

export function runConformanceSuite(
  analyzer: LanguageAnalyzer,
  fixtures: ConformanceFixture[],
): void {
  describe(`${analyzer.id} conformance`, () => {
    for (const fix of fixtures) {
      describe(`file: ${fix.filePath}`, () => {
        const projectCtx: ProjectContext = {
          repoRoot: fix.ctx.repoRoot,
          config: {},
          resolveExternal: () => null,
        };

        beforeAll(async () => {
          await analyzer.init(projectCtx);
        });

        it('returns a valid AnalysisFragment', async () => {
          const result = await analyzer.analyzeFile(fix.filePath, fix.content);
          expect(result).toBeDefined();
          expect(result.file.id).toBe(fix.expectedFileId);
          expect(result.file.kind).toBe('file');
          expect(Array.isArray(result.symbols)).toBe(true);
          expect(Array.isArray(result.edges)).toBe(true);
        });

        it('includes a file node with correct id and path', async () => {
          const result = await analyzer.analyzeFile(fix.filePath, fix.content);
          expect(result.file.id).toBe(fix.expectedFileId);
          expect(result.file.kind).toBe('file');
          expect(result.file.file).toBe(fix.filePath);
        });

        if (fix.expectedSymbols && fix.expectedSymbols.length > 0) {
          it('includes expected top-level symbols', async () => {
            const result = await analyzer.analyzeFile(fix.filePath, fix.content);
            const symbolNames = result.symbols.map((n) => n.name);
            for (const expected of fix.expectedSymbols!) {
              expect(symbolNames).toContain(expected);
            }
          });
        }

        if (fix.expectedExternalIncludes && fix.expectedExternalIncludes.length > 0) {
          it('records unresolved includes in imports', async () => {
            const result = await analyzer.analyzeFile(fix.filePath, fix.content);
            const extSpecifiers = result.imports
              .filter((i) => i.isUnresolved)
              .map((i) => `ext:${i.specifier}`);
            for (const expected of fix.expectedExternalIncludes!) {
              expect(extSpecifiers).toContain(expected);
            }
          });

          it('emits import edges to external targets', async () => {
            const result = await analyzer.analyzeFile(fix.filePath, fix.content);
            const unresEdgeDsts = result.edges
              .filter((e) => e.resolution === 'unresolved')
              .map((e) => e.to);
            for (const expected of fix.expectedExternalIncludes!) {
              expect(unresEdgeDsts).toContain(expected);
            }
          });
        }

        if (fix.expectsInProjectImport) {
          it('emits an in-project import edge', async () => {
            const result = await analyzer.analyzeFile(fix.filePath, fix.content);
            const inProject = result.edges.filter(
              (e) => e.resolution === 'resolved' && e.targetType === 'file',
            );
            expect(inProject.length).toBeGreaterThan(0);
          });
        }

        it('is deterministic', async () => {
          const r1 = await analyzer.analyzeFile(fix.filePath, fix.content);
          const r2 = await analyzer.analyzeFile(fix.filePath, fix.content);
          expect(r1.symbols.map((n) => n.id).sort()).toEqual(r2.symbols.map((n) => n.id).sort());
          expect(r1.edges.length).toBe(r2.edges.length);
        });
      });
    }
  });
}
