import { relative, extname } from "node:path";
import { readFile } from "node:fs/promises";
import type { GraphStore, WorktreeId } from "../graph/store.js";
import type { ParseCache, CacheKey } from "../cache/index.js";
import { contentHash } from "../cache/index.js";
import type { AnalyzerRegistry } from "../analyzers/registry.js";
import type { AnalysisFragment, ProjectContext } from "../analyzers/types.js";
import { InvalidationEmitter } from "./events.js";
import { applyBaseFile, removeBaseFile, applyOverlayFile, removeOverlayFile } from "./apply.js";

export { InvalidationEmitter };

export interface OrchestratorOptions {
  repoRoot: string;
  store: GraphStore;
  cache: ParseCache;
  registry: AnalyzerRegistry;
  projectContext: ProjectContext;
}

export class Orchestrator {
  readonly events = new InvalidationEmitter();
  private repoRoot: string;
  private store: GraphStore;
  private cache: ParseCache;
  private registry: AnalyzerRegistry;
  private projectContext: ProjectContext;

  constructor(opts: OrchestratorOptions) {
    this.repoRoot = opts.repoRoot;
    this.store = opts.store;
    this.cache = opts.cache;
    this.registry = opts.registry;
    this.projectContext = opts.projectContext;
  }

  /** Initialize all registered analyzers with the project context. */
  async init(): Promise<void> {
    for (const analyzer of this.registry.all()) {
      await analyzer.init(this.projectContext);
    }
  }

  /** Dispose all registered analyzers. */
  async dispose(): Promise<void> {
    for (const analyzer of this.registry.all()) {
      await analyzer.dispose();
    }
  }

  private repoRelPath(absPath: string): string {
    return relative(this.repoRoot, absPath).split("\\").join("/");
  }

  /**
   * Cache-first analyze a file. Returns the fragment, storing it in cache on miss.
   */
  async analyzeFile(absPath: string): Promise<AnalysisFragment | null> {
    const ext = extname(absPath).toLowerCase();
    const analyzer = this.registry.forExtension(ext);
    if (!analyzer) return null;

    let text: string;
    try {
      text = await readFile(absPath, "utf8");
    } catch {
      return null;
    }

    const chash = contentHash(text);
    const key: CacheKey = {
      analyzerId: analyzer.id,
      analyzerVersion: analyzer.version,
      grammarVersion: "0",
      contentHash: chash,
    };

    const cached = this.cache.get(key);
    if (cached) return cached;

    const fragment = await analyzer.analyzeFile(this.repoRelPath(absPath), text);
    this.cache.put(key, fragment);
    return fragment;
  }

  /**
   * Apply a file to the base graph (cache-first).
   */
  async applyBaseFile(absPath: string): Promise<string[]> {
    const fragment = await this.analyzeFile(absPath);
    if (!fragment) return [];
    const relPath = this.repoRelPath(absPath);
    applyBaseFile(this.store, relPath, fragment);
    const nodeIds = [fragment.file.id, ...fragment.symbols.map((s) => s.id)];
    this.events.emitInvalidation(nodeIds);
    return nodeIds;
  }

  /**
   * Remove a file from the base graph.
   */
  removeBaseFile(absPath: string): void {
    const relPath = this.repoRelPath(absPath);
    removeBaseFile(this.store, relPath);
  }

  /**
   * Apply a file to a worktree overlay (cache-first).
   */
  async applyOverlayFile(
    worktreeId: WorktreeId,
    absPath: string,
  ): Promise<string[]> {
    const fragment = await this.analyzeFile(absPath);
    if (!fragment) return [];
    const relPath = this.repoRelPath(absPath);
    applyOverlayFile(this.store, worktreeId, relPath, fragment);
    const nodeIds = [fragment.file.id, ...fragment.symbols.map((s) => s.id)];
    this.events.emitInvalidation(nodeIds);
    return nodeIds;
  }

  /**
   * Mark a file as deleted in a worktree overlay.
   */
  removeOverlayFile(worktreeId: WorktreeId, absPath: string): void {
    const relPath = this.repoRelPath(absPath);
    removeOverlayFile(this.store, worktreeId, relPath);
  }

  composedView(worktreeId: WorktreeId) {
    return this.store.composedView(worktreeId);
  }
}
