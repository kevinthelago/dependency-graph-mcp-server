import type { ZodSchema, z } from "zod";

/**
 * Shared result-convention helpers for all MCP tools.
 *
 * Tools NEVER throw on expected outcomes (not found, no worktree, etc.) —
 * they return these structured objects instead.
 */

/** Shape used by explore-structure tools when they self-register. */
export interface ToolRegistration<S extends ZodSchema = ZodSchema> {
  name: string;
  description?: string;
  inputSchema: S;
  handler(input: z.infer<S>, ctx: { worktreeId: string }): Promise<unknown>;
}

/** Pending registrations queued before a server is attached. */
const _pending: ToolRegistration[] = [];
let _sink: ((reg: ToolRegistration) => void) | null = null;

/**
 * Self-registration entry-point used by tool modules (called at module load time).
 * If a server sink is not yet attached, registrations are queued.
 */
export function registerTool(reg: ToolRegistration): void {
  if (_sink) {
    _sink(reg);
  } else {
    _pending.push(reg);
  }
}

/**
 * Called once by server setup to drain the pending queue and start receiving
 * new self-registrations.
 */
export function initToolSink(fn: (reg: ToolRegistration) => void): void {
  _sink = fn;
  for (const reg of _pending) fn(reg);
  _pending.length = 0;
}

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
