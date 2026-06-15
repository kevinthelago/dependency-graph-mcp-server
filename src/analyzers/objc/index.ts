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

import type { LanguageAnalyzer, AnalysisFragment, ProjectContext, Node } from '../types.js';
// py-1 — will resolve once the tree-sitter scaffold lands on develop
import { loadGrammar, parseSource, runQuery } from '../tree-sitter/index.js';
// cpp-1 — will resolve once the include resolver lands on develop
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

/** Analyzer version — included in the parse-cache key. Bump on any grammar/logic change. */
const ANALYZER_VERSION = '1.0.0';

export class ObjcAnalyzer implements LanguageAnalyzer {
  readonly id = 'objc';
  /** .h shared with C/C++ but analyzed as Obj-C when registered via this analyzer. */
  readonly extensions = ['.m', '.mm', '.h'];
  readonly version = ANALYZER_VERSION;

  private language: unknown = null;
  private resolver: IIncludeResolver | null = null;

  async init(project: ProjectContext): Promise<void> {
    this.language = await loadGrammar('objc');
    this.resolver = new IncludeResolver({
      repoRoot: project.repoRoot,
      config: project.config,
    }) as unknown as IIncludeResolver;
  }

  async analyzeFile(filePath: string, text: string): Promise<AnalysisFragment> {
    const lang = this.language!;
    const resolver = this.resolver!;

    const tree = parseSource(lang, text);

    const importCaptures = runQuery(tree, lang, IMPORT_QUERY);
    const symbolCaptures = runQuery(tree, lang, SYMBOL_QUERY);
    const fwdCaptures = runQuery(tree, lang, FORWARD_DECL_QUERY);
    const implCaptures = runQuery(tree, lang, IMPL_QUERY);

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
