/**
 * Shared conformance suite for LanguageAnalyzer implementations.
 *
 * Each analyzer calls runConformanceSuite(analyzer, cases) in its own
 * vitest describe block. The harness asserts the contract invariants;
 * language-specific cases are added alongside.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { LanguageAnalyzer, ProjectContext, AnalysisFragment } from "../../src/analyzers/types.js";

export interface ConformanceCase {
  /** Repo-relative file path, e.g. "src/foo.ts". */
  filePath: string;
  /** Source text to analyze. */
  text: string;
  /** Expected top-level symbol names (order-insensitive). */
  expectedSymbols?: string[];
  /** Expected import specs (resolved or not). */
  expectedImportSpecs?: string[];
  /** At least one edge with resolution "unresolved" expected? */
  expectsUnresolved?: boolean;
  /** At least one edge to an external node expected? */
  expectsExternalEdge?: boolean;
}

const FAKE_PROJECT_CONTEXT: ProjectContext = {
  repoRoot: "/fake/repo",
  config: {},
  resolveExternal(spec) {
    return { specifier: spec, language: "unknown" };
  },
};

export function runConformanceSuite(
  getAnalyzer: () => LanguageAnalyzer,
  cases: ConformanceCase[],
): void {
  let analyzer: LanguageAnalyzer;

  beforeAll(async () => {
    analyzer = getAnalyzer();
    await analyzer.init(FAKE_PROJECT_CONTEXT);
  });

  afterAll(async () => {
    await analyzer.dispose();
  });

  for (const tc of cases) {
    describe(`conformance: ${tc.filePath}`, () => {
      let fragment: AnalysisFragment;

      beforeAll(async () => {
        fragment = await analyzer.analyzeFile(tc.filePath, tc.text);
      });

      it("returns a file node", () => {
        expect(fragment.file).toBeDefined();
        expect(fragment.file.kind).toBe("file");
        expect(fragment.file.id).toMatch(/^file:/);
        expect(fragment.file.name).toBeTruthy();
      });

      it("file node id is stable across two calls", async () => {
        const fragment2 = await analyzer.analyzeFile(tc.filePath, tc.text);
        expect(fragment2.file.id).toBe(fragment.file.id);
      });

      it("symbol nodes have correct kinds", () => {
        for (const sym of fragment.symbols) {
          expect(sym.kind).toBe("symbol");
          expect(sym.id).toMatch(/^sym:/);
          expect(sym.name).toBeTruthy();
          expect(sym.file).toBe(tc.filePath);
        }
      });

      if (tc.expectedSymbols) {
        it("emits expected top-level symbols", () => {
          const names = fragment.symbols.map((s) => s.name);
          for (const expected of tc.expectedSymbols!) {
            expect(names).toContain(expected);
          }
        });
      }

      it("symbol ordering is deterministic", async () => {
        const fragment2 = await analyzer.analyzeFile(tc.filePath, tc.text);
        expect(fragment2.symbols.map((s) => s.id)).toEqual(
          fragment.symbols.map((s) => s.id),
        );
      });

      it("edge ordering is deterministic", async () => {
        const fragment2 = await analyzer.analyzeFile(tc.filePath, tc.text);
        const edgeKey = (e: { from: string; kind: string; to: string }) =>
          `${e.from}||${e.kind}||${e.to}`;
        expect(fragment2.edges.map(edgeKey)).toEqual(
          fragment.edges.map(edgeKey),
        );
      });

      it("all edges have from/to/kind/resolution", () => {
        for (const edge of fragment.edges) {
          expect(edge.from).toBeTruthy();
          expect(edge.to).toBeTruthy();
          expect(["import", "reference"]).toContain(edge.kind);
          expect(["resolved", "unresolved"]).toContain(edge.resolution);
        }
      });

      if (tc.expectsUnresolved) {
        it("has at least one unresolved edge", () => {
          const unresolved = fragment.edges.filter(
            (e) => e.resolution === "unresolved",
          );
          expect(unresolved.length).toBeGreaterThan(0);
        });
      }

      if (tc.expectsExternalEdge) {
        it("has at least one edge to an external node", () => {
          const external = fragment.edges.filter(
            (e) => e.targetType === "external",
          );
          expect(external.length).toBeGreaterThan(0);
        });
      }

      it("does not throw on empty input", async () => {
        const emptyFragment = await analyzer.analyzeFile(tc.filePath, "");
        expect(emptyFragment.file).toBeDefined();
        expect(emptyFragment.file.kind).toBe("file");
      });
    });
  }
}
