// STUB — core-2 (core stream) owns and will replace this.
// Matches contracts/graph-model.md exactly.

export type NodeKind = 'file' | 'symbol' | 'external'
export type Language = 'ts' | 'js' | 'python' | 'rust' | 'c' | 'cpp' | 'objc' | null
export type SymbolKind =
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
  | 'trait'

export interface Loc {
  line: number
  col: number
}

export interface Node {
  id: string
  kind: NodeKind
  language: Language
  name: string
  symbolKind?: SymbolKind
  file?: string
  loc?: Loc
  exported?: boolean
}

export type EdgeKind = 'import' | 'reference'
export type TargetType = 'file' | 'symbol' | 'external'
export type Resolution = 'resolved' | 'unresolved'

export interface Edge {
  from: string
  to: string
  kind: EdgeKind
  targetType: TargetType
  typeOnly?: boolean
  wildcard?: boolean
  resolution: Resolution
  loc?: Loc
}
