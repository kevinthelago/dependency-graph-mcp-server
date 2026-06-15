import type { Node, Edge, SymbolKind } from "../graph/model.js";

// ── Re-exports for cross-stream compatibility ─────────────────────────────────
// Other streams import Node, Edge, SymbolKind, and GraphNode from this module.
export type { Node, Edge, SymbolKind };
/** @deprecated Use Node from graph/model.js */
export type GraphNode = Node;

/**
 * A single import reference produced by language analyzers.
 *
 * Fields reflect the union of what all analyzers produce:
 *   - cpp/python use specifier + isExternal/isUnresolved/wildcard
 *   - ts/rust use specifier + resolution
 */
export interface ImportRef {
  specifier: string;
  resolvedPath?: string;
  isExternal?: boolean;
  isUnresolved?: boolean;
  wildcard?: boolean;
  resolution?: "resolved" | "unresolved";
}

export interface ExternalRef {
  /** Opaque id in the form `ext:<language>:<spec>`. */
  id: string;
}

export interface AnalysisFragment {
  file: GraphNode;
  symbols: GraphNode[];
  edges: Edge[];
  imports: ImportRef[];
}

export interface ProjectContext {
  repoRoot: string;
  /** Language-specific config — tsconfig path, source roots, compile_commands, etc. */
  config: Record<string, unknown>;
  resolveExternal(spec: string): ExternalRef | null;
}

export interface LanguageAnalyzer {
  readonly id: string;
  readonly extensions: string[];
  /** Analyzer version — used as part of the parse-cache key. */
  readonly version: string;
  init(project: ProjectContext): Promise<void>;
  analyzeFile(path: string, text: string): Promise<AnalysisFragment>;
  dispose(): Promise<void>;
}
