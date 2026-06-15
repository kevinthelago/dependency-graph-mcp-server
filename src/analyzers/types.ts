// STUB — core-5 (core stream) owns and will replace this.
// Matches contracts/language-analyzer.md exactly.

import type { Node, Edge } from '../graph/model.js'

export interface ExternalRef {
  id: string
  spec: string
}

export interface ProjectContext {
  repoRoot: string
  config: Record<string, unknown>
  resolveExternal(spec: string): ExternalRef | null
}

export interface ImportRef {
  targetId: string
  resolution: 'resolved' | 'unresolved'
}

export interface AnalysisFragment {
  file: Node
  symbols: Node[]
  edges: Edge[]
  imports: ImportRef[]
}

export interface LanguageAnalyzer {
  readonly id: string
  readonly extensions: string[]
  readonly version: string
  init(project: ProjectContext): Promise<void>
  analyzeFile(path: string, text: string): Promise<AnalysisFragment>
  dispose(): Promise<void>
}
