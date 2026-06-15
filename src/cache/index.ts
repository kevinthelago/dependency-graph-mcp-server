/**
 * Parse cache — owned by core-4; stub for worktree-view compilation.
 */

import type { AnalysisFragment } from "../analyzers/types.js";

export interface ParseCache {
  get(key: string): AnalysisFragment | undefined;
  put(key: string, fragment: AnalysisFragment): void;
}

export declare function getParseCache(): ParseCache;

export function makeCacheKey(
  analyzerId: string,
  analyzerVersion: string,
  grammarVersion: string,
  contentHash: string,
): string {
  return `${analyzerId}:${analyzerVersion}:${grammarVersion}:${contentHash}`;
}
