/**
 * Worktree registry — owned by core-7; stub for worktree-view compilation.
 * See contracts/worktree-registry.md.
 */

import type { Overlay } from "../graph/store.js";

export interface WorktreeEntry {
  worktreeId: string;
  worktreeRoot: string;
  baseBranch: string;
  overlay: Overlay;
  lastActivityAt: number;
}

export declare function getWorktreeEntry(worktreeId: string): WorktreeEntry | undefined;
export declare function setWorktreeEntry(entry: WorktreeEntry): void;
export declare function removeWorktreeEntry(worktreeId: string): void;
export declare function allWorktreeIds(): string[];
