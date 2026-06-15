/**
 * wv-4: Path confinement — reject `..`/symlink escapes from worktree/repo roots.
 *
 * All worktree roots must resolve inside the repo's known worktree set.
 * Analyzer and watcher file access is confined to the configured roots.
 */

import * as nodePath from "node:path";
import * as fs from "node:fs/promises";

export class ConfinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfinementError";
  }
}

/**
 * Resolve and validate that `targetPath` stays within `allowedRoot`.
 *
 * - Resolves symlinks on the target path (realpath).
 * - Rejects if the realpath is outside allowedRoot.
 * - Rejects paths containing `..` components before resolution (belt-and-suspenders).
 *
 * Returns the resolved real path on success.
 * Throws ConfinementError if the path escapes.
 */
export async function confinePathToRoot(
  targetPath: string,
  allowedRoot: string,
): Promise<string> {
  // Belt-and-suspenders: reject `..` segments before any resolution
  const normalized = nodePath.normalize(targetPath);
  if (normalized.includes("..")) {
    throw new ConfinementError(
      `Path contains '..' components and is not allowed: ${targetPath}`,
    );
  }

  // Resolve symlinks
  let real: string;
  try {
    real = await fs.realpath(targetPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Path does not exist yet (e.g. being created). Resolve the nearest
      // existing ancestor and check that.
      real = await resolveNearestExistingAncestor(targetPath);
    } else {
      throw new ConfinementError(
        `Cannot resolve path: ${targetPath} — ${String(err)}`,
      );
    }
  }

  const resolvedRoot = await fs.realpath(allowedRoot);

  if (!isWithin(real, resolvedRoot)) {
    throw new ConfinementError(
      `Path '${real}' is outside allowed root '${resolvedRoot}'`,
    );
  }

  return real;
}

/**
 * Validate that a worktree root is within one of the allowed worktree paths.
 *
 * @param worktreeRoot  Path to check (will be realpath-resolved).
 * @param allowedRoots  Set of known worktree root paths (realpath-resolved).
 */
export async function confineWorktreeRoot(
  worktreeRoot: string,
  allowedRoots: string[],
): Promise<string> {
  let real: string;
  try {
    real = await fs.realpath(worktreeRoot);
  } catch {
    throw new ConfinementError(
      `Worktree root does not exist or cannot be read: ${worktreeRoot}`,
    );
  }

  const resolvedAllowed = await Promise.all(
    allowedRoots.map((r) => fs.realpath(r).catch(() => r)),
  );

  // The root must exactly match one allowed root, or be a subdirectory of one.
  const ok = resolvedAllowed.some((allowed) => isWithin(real, allowed));
  if (!ok) {
    throw new ConfinementError(
      `Worktree root '${real}' is not within any known worktree: [${resolvedAllowed.join(", ")}]`,
    );
  }

  return real;
}

/**
 * Confirm that `candidate` is within (or equal to) `root`.
 * Both must already be resolved real paths.
 */
export function isWithin(candidate: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
  const c = norm(candidate);
  const r = norm(root);
  return c === r || c.startsWith(r + "/");
}

/** Walk up until we find an existing path, return its realpath. */
async function resolveNearestExistingAncestor(p: string): Promise<string> {
  let current = nodePath.resolve(p);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fs.realpath(current);
    } catch {
      const parent = nodePath.dirname(current);
      if (parent === current) {
        // Reached filesystem root without finding an existing path
        throw new ConfinementError(`Cannot resolve any ancestor of: ${p}`);
      }
      current = parent;
    }
  }
}
