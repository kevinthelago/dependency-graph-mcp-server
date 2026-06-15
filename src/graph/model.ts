/** Stable, opaque node identifier. Prefix encodes kind: file:/ sym:/ ext: */
export type NodeId = string;

export type NodeKind = "file" | "symbol" | "external";

/** Edge kinds used by the dependency-graph store (develop/core). */
export type EdgeKind =
  | "imports"
  | "references"
  | "extends"
  | "implements"
  | "re-exports";

export interface FileNodeAttrs {
  kind: "file";
  filePath: string;
  /** Relative display name (e.g. "src/utils/foo.ts") */
  displayName: string;
  language?: string;
  worktreeId?: string;
}

export interface SymbolNodeAttrs {
  kind: "symbol";
  filePath: string;
  symbolName: string;
  displayName: string;
  worktreeId?: string;
}

export interface ExternalNodeAttrs {
  kind: "external";
  packageName: string;
  displayName: string;
}

export type NodeAttrs = FileNodeAttrs | SymbolNodeAttrs | ExternalNodeAttrs;

export interface EdgeAttrs {
  kind: EdgeKind;
  /** Optional line in the source file where this edge originates */
  line?: number;
}

// ── Analyzer-layer types (used by LanguageAnalyzer and the overlay engine) ──

export type Language = "ts" | "js" | "python" | "rust" | "c" | "cpp" | "objc" | null;
export type SymbolKind =
  | "function"
  | "class"
  | "variable"
  | "interface"
  | "type"
  | "enum"
  | "module"
  | "macro"
  | "protocol"
  | "struct"
  | "trait";

export interface Loc {
  line: number;
  col: number;
}

/** Flat node representation produced by language analyzers and stored in overlays. */
export interface Node {
  id: string;
  kind: NodeKind;
  language: Language;
  name: string;
  symbolKind?: SymbolKind;
  file?: string;
  loc?: Loc;
  exported?: boolean;
}

export type AnalyzerEdgeKind = "import" | "reference";
export type TargetType = "file" | "symbol" | "external";
export type Resolution = "resolved" | "unresolved";

/** File-granularity slice: a file node + its symbols + their edges. */
export interface FileSlice {
  filePath: string;
  nodes: Node[];
  edges: Edge[];
}

/** Edge representation produced by language analyzers and stored in overlays. */
export interface Edge {
  from: string;
  to: string;
  kind: AnalyzerEdgeKind;
  targetType: TargetType;
  typeOnly?: boolean;
  wildcard?: boolean;
  resolution: Resolution;
  loc?: Loc;
}
