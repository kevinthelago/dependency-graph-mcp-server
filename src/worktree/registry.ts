import { resolve, relative, isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import type { WorktreeId } from "../graph/store.js";
import { MemoryOverlay, type Overlay } from "../graph/store.js";

export interface WorktreeEntry {
  worktreeId: WorktreeId;
  worktreeRoot: string;
  repoRoot: string;
  baseBranch: string;
  /** ISO timestamp of last registration/refresh. */
  registeredAt: string;
  /** Per-worktree file-level overlay. */
  overlay: Overlay;
}

let nextId = 1;

export class WorktreeRegistry {
  private entries = new Map<WorktreeId, WorktreeEntry>();
  private byPath = new Map<string, WorktreeId>();
  private repoRoot: string;
  private defaultBase: string;

  constructor(repoRoot: string, defaultBase = "develop") {
    this.repoRoot = resolve(repoRoot);
    this.defaultBase = defaultBase;
  }

  async register(opts: {
    worktreeRoot: string;
    baseBranch?: string;
  }): Promise<WorktreeEntry> {
    const rawRoot = opts.worktreeRoot;
    if (!rawRoot) throw new Error("worktreeRoot is required");

    const absRoot = isAbsolute(rawRoot)
      ? rawRoot
      : resolve(this.repoRoot, rawRoot);

    const preRel = relative(this.repoRoot, absRoot);
    if (preRel.startsWith("..") || isAbsolute(preRel)) {
      throw new Error(
        `worktreeRoot escapes repo boundary: ${absRoot} (repo: ${this.repoRoot})`,
      );
    }

    let realRoot: string;
    try {
      realRoot = await realpath(absRoot);
    } catch {
      throw new Error(`worktreeRoot does not exist: ${absRoot}`);
    }

    const rel = relative(this.repoRoot, realRoot);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `worktreeRoot escapes repo boundary via symlink: ${realRoot} (repo: ${this.repoRoot})`,
      );
    }

    const existing = this.byPath.get(realRoot);
    if (existing) {
      const entry = this.entries.get(existing)!;
      entry.registeredAt = new Date().toISOString();
      if (opts.baseBranch) entry.baseBranch = opts.baseBranch;
      return entry;
    }

    const worktreeId: WorktreeId = `wt-${nextId++}`;
    const entry: WorktreeEntry = {
      worktreeId,
      worktreeRoot: realRoot,
      repoRoot: this.repoRoot,
      baseBranch: opts.baseBranch ?? this.defaultBase,
      registeredAt: new Date().toISOString(),
      overlay: new MemoryOverlay(),
    };
    this.entries.set(worktreeId, entry);
    this.byPath.set(realRoot, worktreeId);
    return entry;
  }

  get(worktreeId: WorktreeId): WorktreeEntry | undefined {
    return this.entries.get(worktreeId);
  }

  remove(worktreeId: WorktreeId): void {
    const entry = this.entries.get(worktreeId);
    if (entry) {
      this.byPath.delete(entry.worktreeRoot);
      this.entries.delete(worktreeId);
    }
  }

  all(): WorktreeEntry[] {
    return [...this.entries.values()];
  }

  confinePath(worktreeId: WorktreeId, filePath: string): string {
    const entry = this.entries.get(worktreeId);
    if (!entry) throw new Error(`Unknown worktreeId: ${worktreeId}`);
    const abs = isAbsolute(filePath)
      ? filePath
      : resolve(entry.worktreeRoot, filePath);
    const rel = relative(entry.worktreeRoot, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `Path escapes worktree boundary: ${abs} (root: ${entry.worktreeRoot})`,
      );
    }
    return abs;
  }
}
