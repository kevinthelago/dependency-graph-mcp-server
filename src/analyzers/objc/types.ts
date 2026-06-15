/**
 * Local type definitions for the Obj-C analyzer.
 *
 * Node / Edge / AnalysisFragment / LanguageAnalyzer / ProjectContext are defined
 * here until src/analyzers/types.ts (core-5) lands on develop. At that point,
 * symbols.ts / imports.ts / index.ts should be updated to import from
 * '../types.js' instead.
 *
 * These shapes follow contracts/language-analyzer.md and contracts/graph-model.md.
 */

// ────────────────────────────────────────────────────────────────────────────
// Graph model (contracts/graph-model.md)
// ────────────────────────────────────────────────────────────────────────────

export interface Node {
  id: string;
  kind: 'file' | 'symbol' | 'external';
  language: 'ts' | 'js' | 'python' | 'rust' | 'c' | 'cpp' | 'objc' | null;
  name: string;
  symbolKind?:
    | 'function'
    | 'class'
    | 'variable'
    | 'interface'
    | 'type'
    | 'enum'
    | 'module'
    | 'macro'
    | 'protocol'
    | 'struct'
    | 'trait';
  file?: string;
  loc?: { line: number; col: number };
  exported?: boolean;
}

export interface Edge {
  from: string;
  to: string;
  kind: 'import' | 'reference';
  targetType: 'file' | 'symbol' | 'external';
  typeOnly?: boolean;
  wildcard?: boolean;
  resolution: 'resolved' | 'unresolved';
  loc?: { line: number; col: number };
}

export interface ImportRef {
  spec: string;
  resolvedPath?: string;
  resolution: 'resolved' | 'unresolved';
}

export interface AnalysisFragment {
  file: Node;
  symbols: Node[];
  edges: Edge[];
  imports: ImportRef[];
}

// ────────────────────────────────────────────────────────────────────────────
// Analyzer interface (contracts/language-analyzer.md)
// ────────────────────────────────────────────────────────────────────────────

export interface ExternalRef {
  id: string;
  name: string;
}

export interface ProjectContext {
  repoRoot: string;
  config: Record<string, unknown>;
  resolveExternal(spec: string): ExternalRef | null;
}

export interface LanguageAnalyzer {
  readonly id: string;
  readonly extensions: string[];
  readonly version: string;
  init(project: ProjectContext): Promise<void>;
  analyzeFile(path: string, text: string): Promise<AnalysisFragment>;
  dispose(): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Tree-sitter scaffold (py-1 / src/analyzers/tree-sitter/)
// ────────────────────────────────────────────────────────────────────────────

/** A single named capture returned by the scaffold's query runner. */
export interface CaptureResult {
  /** Capture name from the query (e.g. "interface", "quoted-import"). */
  name: string;
  /** The node's source text. */
  text: string;
  /** Zero-based source position of the captured node. */
  startPosition: { row: number; column: number };
}

// ────────────────────────────────────────────────────────────────────────────
// Include resolver (cpp-1 / src/analyzers/cpp/resolver.ts)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result from the include resolver.
 * Resolved paths are repo-relative; external targets carry the specifier.
 */
export type IncludeResolveResult =
  | { kind: 'file'; repoRelPath: string }
  | { kind: 'external'; spec: string };

/**
 * Minimal interface we call on the IncludeResolver from cpp-1.
 * The real class may expose more; we only use this surface.
 */
export interface IIncludeResolver {
  resolve(
    spec: string,
    fromFile: string,
    quoted: boolean,
  ): IncludeResolveResult | null;
}
