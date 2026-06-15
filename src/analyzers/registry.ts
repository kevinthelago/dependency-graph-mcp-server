/**
 * Analyzer registry — owned by core-5; stub for worktree-view compilation.
 */

import type { LanguageAnalyzer } from "./types.js";

export declare function getAnalyzerForFile(filePath: string): LanguageAnalyzer | undefined;
export declare function registerAnalyzer(analyzer: LanguageAnalyzer): void;

export interface AnalyzerRegistry {
  all(): LanguageAnalyzer[];
  forExtension(ext: string): LanguageAnalyzer | undefined;
}
