/**
 * Worktree registry — in-memory implementation.
 * Owned by core-7; this implementation satisfies the unit-test contract until
 * the core stream lands its durable version.
 */

import * as nodePath from 'node:path';
import * as fs from 'node:fs/promises';
import { confinePathToRoot, ConfinementError, isWithin } from './confine.js';

export interface WorktreeEntry {
  worktreeId: string;
  worktreeRoot: string;
  baseBranch: string;
}

let _counter = 0;

export class WorktreeRegistry {
  private readonly _repoRoot: string;
  private readonly _entries = new Map<string, WorktreeEntry>();
  private readonly _byRoot = new Map<string, WorktreeEntry>();

  constructor(repoRoot: string) {
    this._repoRoot = repoRoot;
  }

  async register(opts: { worktreeRoot: string }): Promise<WorktreeEntry> {
    const real = await confineToRepo(opts.worktreeRoot, this._repoRoot);

    const existing = this._byRoot.get(real);
    if (existing) return existing;

    const id = `wt-${++_counter}`;
    const entry: WorktreeEntry = {
      worktreeId: id,
      worktreeRoot: real,
      baseBranch: 'develop',
    };
    this._entries.set(id, entry);
    this._byRoot.set(real, entry);
    return entry;
  }

  confinePath(worktreeId: string, relativePath: string): string {
    const entry = this._entries.get(worktreeId);
    if (!entry) throw new Error(`Unknown worktree: ${worktreeId}`);
    const joined = nodePath.join(entry.worktreeRoot, relativePath);
    const normalized = nodePath.normalize(joined);
    if (!isWithin(normalized, entry.worktreeRoot)) {
      throw new ConfinementError(
        `Path '${relativePath}' would escape worktree root — access denied`,
      );
    }
    return normalized;
  }
}

async function confineToRepo(targetPath: string, repoRoot: string): Promise<string> {
  const resolvedRepo = await fs.realpath(repoRoot);
  let real: string;
  try {
    real = await fs.realpath(targetPath);
  } catch {
    // Path doesn't exist yet — check normalized form against repo root
    const normalized = nodePath.resolve(targetPath);
    if (!isWithin(normalized, resolvedRepo)) {
      throw new ConfinementError(
        `Path '${normalized}' would escape repo root '${resolvedRepo}'`,
      );
    }
    real = normalized;
  }
  if (!isWithin(real, resolvedRepo)) {
    throw new ConfinementError(
      `Path '${real}' would escape repo root '${resolvedRepo}'`,
    );
  }
  return real;
}
