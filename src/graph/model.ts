/** Stable, opaque node identifier. Prefix encodes kind: file:/ sym:/ ext: */
export type NodeId = string;

export type NodeKind = "file" | "symbol" | "external";

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
