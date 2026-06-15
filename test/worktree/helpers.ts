/**
 * Test helpers shared by worktree tests.
 */

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import * as os from "node:os";
import type { Overlay, OverlaySlice } from "../../src/graph/store.js";
import type { Node } from "../../src/graph/model.js";
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext } from "../../src/analyzers/types.js";
import type { ICacheStore, CacheKey } from "../../src/cache/index.js";

/** Create a temporary directory and return its path. Cleaned up by the caller. */
export async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(nodePath.join(os.tmpdir(), "wv-test-"));
}

/** Write a file relative to a root directory. */
export async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const abs = nodePath.join(root, relPath);
  await fs.mkdir(nodePath.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

/** A minimal in-memory Overlay implementation for testing. */
export class MemoryOverlay implements Overlay {
  private readonly applied = new Map<string, OverlaySlice>();
  private readonly deleted = new Set<string>();

  applyFile(filePath: string, slice: OverlaySlice): void {
    this.deleted.delete(filePath);
    this.applied.set(filePath, slice);
  }

  deleteFile(filePath: string): void {
    this.applied.delete(filePath);
    this.deleted.add(filePath);
  }

  clearFile(filePath: string): void {
    this.applied.delete(filePath);
    this.deleted.delete(filePath);
  }

  isEmpty(): boolean {
    return this.applied.size === 0 && this.deleted.size === 0;
  }

  coveredFiles(): ReadonlySet<string> {
    return new Set([...this.applied.keys(), ...this.deleted]);
  }

  isDeleted(filePath: string): boolean {
    return this.deleted.has(filePath);
  }

  getSlice(filePath: string): OverlaySlice | undefined {
    return this.applied.get(filePath);
  }

  appliedCount(): number {
    return this.applied.size;
  }

  deletedCount(): number {
    return this.deleted.size;
  }
}

/** A no-op parse cache for testing. */
export class NoopCache implements ICacheStore {
  get(_key: CacheKey): undefined {
    return undefined;
  }
  put(_key: CacheKey, _fragment: AnalysisFragment): void {}
}

/** An in-memory cache for testing cache-first behaviour. */
export class MemoryCache implements ICacheStore {
  private readonly store = new Map<string, AnalysisFragment>();

  private static key(k: CacheKey): string {
    return `${k.analyzerId}:${k.analyzerVersion}:${k.grammarVersion}:${k.contentHash}`;
  }

  get(key: CacheKey): AnalysisFragment | undefined {
    return this.store.get(MemoryCache.key(key));
  }

  put(key: CacheKey, fragment: AnalysisFragment): void {
    this.store.set(MemoryCache.key(key), fragment);
  }

  size(): number {
    return this.store.size;
  }
}

/** Create a minimal file Node. */
export function fileNode(filePath: string): Node {
  return {
    id: `file:${filePath}`,
    kind: "file",
    language: "ts",
    name: filePath,
  };
}

/** A stub LanguageAnalyzer for testing. */
export function makeStubAnalyzer(
  extensions: string[],
  fragmentFor: (path: string, text: string) => AnalysisFragment,
): LanguageAnalyzer {
  return {
    id: "stub",
    extensions,
    version: "0.0.1",
    async init(_ctx: ProjectContext): Promise<void> {},
    async analyzeFile(path: string, text: string): Promise<AnalysisFragment> {
      return fragmentFor(path, text);
    },
    async dispose(): Promise<void> {},
  };
}

/** Minimal ProjectContext. */
export const testProjectContext: ProjectContext = {
  repoRoot: "/tmp/test-repo",
  config: {},
  resolveExternal: () => null,
};
