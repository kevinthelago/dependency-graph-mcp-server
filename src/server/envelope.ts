/**
 * Shared result-convention helpers for all MCP tools.
 *
 * Tools NEVER throw on expected outcomes (not found, no worktree, etc.) —
 * they return these structured objects instead.
 */

export interface NotFound {
  found: false;
  candidates?: string[];
}

export interface Truncated<T> {
  truncated: true;
  cursor: string;
  items: T[];
}

export interface NoWorktree {
  error: "no_worktree";
  message: string;
}

export interface StructuredError {
  error: string;
  message: string;
}

export function notFound(candidates?: string[]): NotFound {
  return candidates ? { found: false, candidates } : { found: false };
}

export function noWorktree(): NoWorktree {
  return {
    error: "no_worktree",
    message:
      "No worktree is bound to this session. Call register_worktree first.",
  };
}

export function structuredError(error: string, message: string): StructuredError {
  return { error, message };
}

export function paginate<T>(
  items: T[],
  limit: number,
  cursorIndex = 0,
): { items: T[]; truncated?: true; cursor?: string } {
  const page = items.slice(cursorIndex, cursorIndex + limit);
  if (cursorIndex + limit < items.length) {
    return {
      items: page,
      truncated: true,
      cursor: String(cursorIndex + limit),
    };
  }
  return { items: page };
}
