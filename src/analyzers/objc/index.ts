/**
 * Objective-C language analyzer (objc-1).
 *
 * Implements the LanguageAnalyzer contract from contracts/language-analyzer.md.
 * Builds on:
 *   - tree-sitter scaffold (py-1 / src/analyzers/tree-sitter/) for grammar loading
 *   - include resolver (cpp-1 / src/analyzers/cpp/resolver.ts) for path resolution
 *
 * Primary edge type: import (#import / #include / @import).
 * Symbols: @interface, @protocol, #define macros; categories → class association edges.
 * .mm files: same parsing, best-effort (Obj-C++ extension syntax silently ignored).
 */

// Local type definitions until src/analyzers/types.ts (core-5) lands on develop.
// When it does: replace this import with `from '../types.js'`.
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext, Node, CaptureResult } from './types.js';
// py-1 — tree-sitter scaffold
import { loadGrammar, resolveGrammarPath, createParser } from '../tree-sitter/loader.js';
import type { Language } from '../tree-sitter/loader.js';
import { QueryRunner } from '../tree-sitter/query-runner.js';
import type { PatternMatch } from '../tree-sitter/query-runner.js';
// cpp-1 — include resolver
import { IncludeResolver } from '../cpp/resolver.js';

import {
  IMPORT_QUERY,
  SYMBOL_QUERY,
  FORWARD_DECL_QUERY,
  IMPL_QUERY,
} from './grammar.js';
import { extractImportEdges } from './imports.js';
import { extractSymbolNodes, extractForwardDeclEdges } from './symbols.js';
import type { IIncludeResolver } from './types.js';

/** Convert real tree-sitter PatternMatch[] to our flat CaptureResult[] shape. */
function flatCaptures(matches: PatternMatch[]): CaptureResult[] {
  return matches.flatMap((m) =>
    m.captures.map((c) => ({
      name: c.name,
      text: c.node.text,
      startPosition: c.node.startPosition,
    })),
  );
}

/** Analyzer version — included in the parse-cache key. Bump on any grammar/logic change. */
const ANALYZER_VERSION = '1.0.0';

export class ObjcAnalyzer implements LanguageAnalyzer {
  readonly id = 'objc';
  /** .h shared with C/C++ but analyzed as Obj-C when registered via this analyzer. */
  readonly extensions = ['.m', '.mm', '.h'];
  readonly version = ANALYZER_VERSION;

  private grammar: Language | null = null;
  private qr: QueryRunner | null = null;
  private resolver: IIncludeResolver | null = null;

  async init(project: ProjectContext): Promise<void> {
    const wasmPath = resolveGrammarPath('tree-sitter-objc');
    this.grammar = await loadGrammar(wasmPath);
    this.qr = new QueryRunner(this.grammar);
    const includeDirs = project.config?.['configuredIncludeDirs'] as string[] | undefined;
    this.resolver = new IncludeResolver({
      projectRoot: project.repoRoot,
      ...(includeDirs ? { includeDirs } : {}),
    }) as unknown as IIncludeResolver;
  }

  async analyzeFile(filePath: string, text: string): Promise<AnalysisFragment> {
    const { grammar, qr, resolver } = this;
    if (!grammar || !qr || !resolver) {
      throw new Error('ObjcAnalyzer.init() must be called before analyzeFile()');
    }

    const parser = await createParser(grammar);
    const rawTree = parser.parse(text);
    if (!rawTree) throw new Error('Failed to parse ' + filePath);
    const tree = rawTree;

    const importCaptures = flatCaptures(qr.matches(IMPORT_QUERY, tree));
    const symbolCaptures = flatCaptures(qr.matches(SYMBOL_QUERY, tree));
    const fwdCaptures    = flatCaptures(qr.matches(FORWARD_DECL_QUERY, tree));
    const implCaptures   = flatCaptures(qr.matches(IMPL_QUERY, tree));

    const fileNode: Node = {
      id: `file:${filePath}`,
      kind: 'file',
      language: 'objc',
      name: filePath,
    };

    const { symbols, categoryEdges } = extractSymbolNodes(
      [...symbolCaptures, ...implCaptures],
      filePath,
    );

    // External nodes are not in the fragment; orchestrator infers them from edge targetType+to fields.
    const { edges: importEdges } = extractImportEdges(
      importCaptures,
      filePath,
      resolver,
    );

    const fwdEdges = extractForwardDeclEdges(fwdCaptures, filePath);

    return {
      file: fileNode,
      symbols,
      edges: [...importEdges, ...categoryEdges, ...fwdEdges],
      // imports field: the graph-side view; orchestrator uses edges directly in v1
      imports: [],
    };
  }

  async dispose(): Promise<void> {
    // Nothing to tear down; grammar is managed by the scaffold.
  }
}

export default ObjcAnalyzer;
