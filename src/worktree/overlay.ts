/**
 * wv-2: Overlay population — seed a worktree overlay from the changed-file set.
 *
 * Re-parses only changed/added files (cache-first) into the overlay.
 * Deleted files are marked deleted. Clean worktree → empty overlay → queries == base.
 */

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import * as crypto from "node:crypto";
import type { Overlay } from "../graph/store.js";
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext } from "../analyzers/types.js";
import type { ICacheStore } from "../cache/index.js";
import { makeCacheKey } from "../cache/index.js";
import type { ChangedFile } from "./diff.js";

export interface SeedOverlayOptions {
  worktreeRoot: string;
  repoRoot: string;
  baseBranch: string;
  overlay: Overlay;
  changedFiles: ChangedFile[];
  getAnalyzer: (filePath: string) => LanguageAnalyzer | undefined;
  cache: ICacheStore;
  projectContext: ProjectContext;
}

/**
 * Populate the overlay from the changed-file set.
 *
 * For each changed/added file: analyze (cache-first) and apply to overlay.
 * For each deleted file: mark deleted in overlay.
 * Files with no registered analyzer are skipped (not graph nodes).
 */
export async function seedOverlay(opts: SeedOverlayOptions): Promise<void> {
  const {
    worktreeRoot,
    overlay,
    changedFiles,
    getAnalyzer,
    cache,
    projectContext,
  } = opts;

  await Promise.all(
    changedFiles.map(async ({ path: filePath, status }) => {
      if (status === "deleted") {
        overlay.deleteFile(filePath);
        return;
      }

      const analyzer = getAnalyzer(filePath);
      if (!analyzer) return;

      const absPath = nodePath.join(worktreeRoot, filePath);
      let text: string;
      try {
        text = await fs.readFile(absPath, "utf8");
      } catch {
        // File disappeared between diff and now — treat as deleted
        overlay.deleteFile(filePath);
        return;
      }

      const fragment = await analyzeFileCacheFirst(
        filePath,
        text,
        analyzer,
        cache,
        projectContext,
      );

      overlay.applyFile(filePath, {
        file: fragment.file,
        symbols: fragment.symbols,
        edges: fragment.edges,
      });
    }),
  );
}

/**
 * Analyze a file, consulting the parse cache first.
 * Cache key = hash(analyzerId + analyzerVersion + grammarVersion + contentHash).
 * grammarVersion is "n/a" for the TS analyzer (no grammar file).
 */
async function analyzeFileCacheFirst(
  filePath: string,
  text: string,
  analyzer: LanguageAnalyzer,
  cache: ICacheStore,
  _projectContext: ProjectContext,
): Promise<AnalysisFragment> {
  const contentHash = sha256(text);
  const key = makeCacheKey(
    analyzer.id,
    analyzer.version,
    "n/a",
    contentHash,
  );

  const cached = cache.get(key);
  if (cached) return cached;

  const fragment = await analyzer.analyzeFile(filePath, text);
  cache.put(key, fragment);
  return fragment;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
