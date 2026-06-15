/**
 * wv-1: git-diff seeding — compute the changed-file set for a worktree.
 *
 * Changed-file set = diff(base → worktree working tree) + uncommitted + untracked.
 * Uses simple-git. Returns a classification per file for the overlay seeder.
 */

import { simpleGit } from "simple-git";
import * as path from "node:path";
import * as fs from "node:fs/promises";

export type FileStatus = "changed" | "added" | "deleted";

export interface ChangedFile {
  /** Repo-relative path (forward slashes). */
  path: string;
  status: FileStatus;
}

/**
 * Compute the changed-file set between baseBranch and the working tree of worktreeRoot.
 *
 * Covers:
 *  - Files differing from the base branch tip (committed or not)
 *  - Uncommitted modifications/additions (staged + unstaged)
 *  - Untracked files
 */
export async function computeChangedFiles(
  worktreeRoot: string,
  baseBranch: string,
  repoRoot: string,
): Promise<ChangedFile[]> {
  const git = simpleGit(worktreeRoot);

  const results = new Map<string, FileStatus>();

  // 1. Files differing between the merge-base of baseBranch and the working tree.
  //    This catches commits on the worktree branch plus any working-tree edits.
  let mergeBase: string;
  try {
    mergeBase = (await git.raw(["merge-base", "HEAD", baseBranch])).trim();
  } catch {
    // If baseBranch doesn't exist yet (e.g. brand new repo), diff from empty tree.
    mergeBase = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git empty tree hash
  }

  // diff between merge-base and the current HEAD (committed changes on this branch)
  try {
    const headDiff = await git.diff(["--name-status", mergeBase, "HEAD"]);
    parseNameStatus(headDiff, repoRoot, worktreeRoot, results);
  } catch {
    // HEAD may not exist (no commits yet); skip
  }

  // 2. Uncommitted changes: staged (index vs HEAD) + unstaged (worktree vs index)
  const status = await git.status();

  for (const f of status.files) {
    const rel = normalisePath(f.path);
    const index = f.index;
    const working = f.working_dir;

    if (index === "D" || working === "D") {
      results.set(rel, "deleted");
    } else if (index === "?" || working === "?") {
      // untracked — handled below
    } else if (index === "A") {
      results.set(rel, "added");
    } else {
      // Any other modification
      if (!results.has(rel)) {
        results.set(rel, "changed");
      }
    }
  }

  // 3. Untracked files
  for (const f of status.not_added) {
    const rel = normalisePath(f);
    if (!results.has(rel)) {
      results.set(rel, "added");
    }
  }

  // 4. Verify deleted files actually don't exist (avoid false deletes)
  const verified: ChangedFile[] = [];
  for (const [filePath, status] of results) {
    if (status === "deleted") {
      const abs = path.join(worktreeRoot, filePath);
      try {
        await fs.access(abs);
        // File exists despite being marked deleted — treat as changed
        verified.push({ path: filePath, status: "changed" });
      } catch {
        verified.push({ path: filePath, status: "deleted" });
      }
    } else {
      verified.push({ path: filePath, status });
    }
  }

  return verified;
}

/** Parse `git diff --name-status` output into the results map. */
function parseNameStatus(
  output: string,
  repoRoot: string,
  worktreeRoot: string,
  results: Map<string, FileStatus>,
): void {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\t/);
    const code = parts[0];
    const rawPath = parts[parts.length - 1];
    if (!rawPath || !code) continue;

    const rel = normalisePath(rawPath);
    if (code.startsWith("D")) {
      results.set(rel, "deleted");
    } else if (code.startsWith("A") || code.startsWith("C")) {
      results.set(rel, "added");
    } else {
      // M, R, T, U → changed
      if (!results.has(rel)) {
        results.set(rel, "changed");
      }
    }
  }
}

/** Normalise a path to forward-slash repo-relative form. */
function normalisePath(p: string): string {
  return p.replace(/\\/g, "/");
}
