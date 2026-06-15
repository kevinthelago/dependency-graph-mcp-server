/**
 * LanguageAnalyzer interface — contract owner: core (core-5).
 * See contracts/language-analyzer.md and contracts/graph-model.md.
 */

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

export type Language = 'ts' | 'js' | 'python' | 'rust' | 'c' | 'cpp' | 'objc' | null

export interface GraphNode {
  id: string
  kind: 'file' | 'symbol' | 'external'
  language: Language
  name: string
  symbolKind?: SymbolKind
  /** Repo-relative path; only on symbol nodes. */
  file?: string
  loc?: { line: number; col: number }
  exported?: boolean
}

export interface Edge {
  from: string
  to: string
  kind: 'import' | 'reference'
  targetType: 'file' | 'symbol' | 'external'
  typeOnly?: boolean
  wildcard?: boolean
  resolution: 'resolved' | 'unresolved'
  loc?: { line: number; col: number }
}

/** A resolved or unresolved import target produced by language analyzers. */
export interface ImportRef {
  specifier: string
  /** Repo-relative path if resolved to a project file. */
  resolvedPath?: string
  isExternal: boolean
  isUnresolved: boolean
  wildcard: boolean
}

export interface ExternalRef {
  /** Opaque id in the form `ext:<language>:<spec>`. */
  id: string
}

export interface AnalysisFragment {
  file: GraphNode
  symbols: GraphNode[]
  edges: Edge[]
  imports: ImportRef[]
}

export interface ProjectContext {
  repoRoot: string
  /** Language-specific config — tsconfig path, source roots, compile_commands, etc. */
  config: Record<string, unknown>
  resolveExternal(spec: string): ExternalRef | null
}

export interface LanguageAnalyzer {
  readonly id: string
  readonly extensions: string[]
  /** Analyzer version — used as part of the parse-cache key. */
  readonly version: string
  init(project: ProjectContext): Promise<void>
  analyzeFile(path: string, text: string): Promise<AnalysisFragment>
  dispose(): Promise<void>
}
