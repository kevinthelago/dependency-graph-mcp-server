import { z } from "zod";
import type { ToolDef } from "../../mcp/types.js";
import type { WorktreeRegistry } from "../../worktree/registry.js";
import { bindSession } from "../../worktree/session.js";

const schema = z.object({
  worktreeRoot: z.string().describe("Absolute or repo-relative path to the worktree root"),
  baseBranch: z.string().optional().describe("Base branch to diff against (default: develop)"),
  /** Client-supplied session key for binding. Defaults to worktreeRoot. */
  sessionKey: z.string().optional(),
});

type Input = z.infer<typeof schema>;

export function makeRegisterWorktreeTool(
  registry: WorktreeRegistry,
): ToolDef<typeof schema> {
  return {
    name: "register_worktree",
    description:
      "Register a git worktree with the MCP server and bind this session to it. " +
      "Must be called before any query tool.",
    schema,
    async handler(input: Input) {
      const entry = await registry.register({
        worktreeRoot: input.worktreeRoot,
      });

      const sessionKey = input.sessionKey ?? entry.worktreeRoot;
      bindSession(sessionKey, entry.worktreeId);

      return {
        worktreeId: entry.worktreeId,
        worktreeRoot: entry.worktreeRoot,
        baseBranch: entry.baseBranch,
        sessionKey,
      };
    },
  };
}
