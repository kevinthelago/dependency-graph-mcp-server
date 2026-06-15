import { resolve } from "node:path";
import fg from "fast-glob";
import type { Orchestrator } from "./index.js";

export interface BaseIndexOptions {
  /** Glob patterns to ignore (relative to repoRoot). */
  ignore?: string[];
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/__pycache__/**",
  "**/target/**",
];

/**
 * Enumerate all source files in repoRoot and analyze them into the base graph.
 * Re-uses the parse cache, so restarts only re-analyze changed files.
 */
export async function buildBaseIndex(
  orchestrator: Orchestrator,
  repoRoot: string,
  opts: BaseIndexOptions = {},
): Promise<{ fileCount: number }> {
  const ignore = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];

  const files = await fg("**/*", {
    cwd: repoRoot,
    absolute: true,
    onlyFiles: true,
    ignore,
    followSymbolicLinks: false,
  });

  // Sort for deterministic ordering
  files.sort();

  let fileCount = 0;
  for (const absPath of files) {
    // Skip files with no analyzer (orchestrator.applyBaseFile checks extension)
    const absResolved = resolve(absPath);
    try {
      await orchestrator.applyBaseFile(absResolved);
      fileCount++;
    } catch {
      // Partial failure: skip the file, log nothing (analyzers must not throw)
    }
  }

  return { fileCount };
}
