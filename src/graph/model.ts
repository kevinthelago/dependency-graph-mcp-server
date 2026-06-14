export type Language = "ts" | "js" | "python" | "rust" | "c" | "cpp" | "objc" | null;
export type NodeKind = "file" | "symbol" | "external";
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
export type EdgeKind = "import" | "reference";

export interface GNode {
  id: string;
  kind: NodeKind;
  language: Language;
  name: string;
  symbolKind?: SymbolKind;
  /** Owning file path for symbol nodes (repo-relative). */
  file?: string;
  loc?: { line: number; col: number };
  exported?: boolean;
}

export interface GEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  targetType: "file" | "symbol" | "external";
  typeOnly?: boolean;
  wildcard?: boolean;
  resolution: "resolved" | "unresolved";
  loc?: { line: number; col: number };
}
