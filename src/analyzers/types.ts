/**
 * LanguageAnalyzer interface per contracts/language-analyzer.md
 * Owned by core-5; stub for worktree-view compilation.
 */

import type { Node, Edge } from "../graph/model.js";

export interface ImportRef {
  specifier: string;
  resolvedPath?: string;
  resolution: "resolved" | "unresolved";
}

export interface AnalysisFragment {
  file: Node;
  symbols: Node[];
  edges: Edge[];
  imports: ImportRef[];
}

export interface ProjectContext {
  repoRoot: string;
  config: Record<string, unknown>;
  resolveExternal(spec: string): { language: string; specifier: string } | null;
}

export interface LanguageAnalyzer {
  readonly id: string;
  readonly extensions: string[];
  readonly version: string;
  init(project: ProjectContext): Promise<void>;
  analyzeFile(path: string, text: string): Promise<AnalysisFragment>;
  dispose(): Promise<void>;
}
