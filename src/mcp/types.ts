import type { z, ZodSchema } from "zod";
import type { WorktreeId } from "../graph/store.js";

export interface ToolCtx {
  /** The worktree bound to this session, if any. */
  worktreeId: WorktreeId | null;
}

export interface ToolDef<S extends ZodSchema> {
  name: string;
  description?: string;
  schema: S;
  handler(input: z.infer<S>, ctx: ToolCtx): Promise<unknown>;
}
