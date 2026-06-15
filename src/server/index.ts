import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodSchema } from "zod";
import { createHttpTransport, type TransportConfig } from "./transport.js";
import type { ToolDef, ToolCtx } from "../mcp/types.js";
import type { WorktreeId } from "../graph/store.js";

/**
 * Session state: maps session ids -> worktree ids.
 * Session ids come from the MCP SDK transport layer.
 */
const sessionMap = new Map<string, WorktreeId>();

export function bindSession(sessionId: string, worktreeId: WorktreeId): void {
  sessionMap.set(sessionId, worktreeId);
}

export function getSessionWorktreeId(sessionId: string): WorktreeId | null {
  return sessionMap.get(sessionId) ?? null;
}

export function unbindSession(sessionId: string): void {
  sessionMap.delete(sessionId);
}

export class McpServer {
  private sdk: SdkMcpServer;
  private boundPort: number | null = null;
  private closeFn: (() => Promise<void>) | null = null;

  constructor(name = "dependency-graph-mcp-server", version = "0.1.0") {
    this.sdk = new SdkMcpServer({ name, version });
  }

  registerTool<S extends ZodSchema>(def: ToolDef<S>): void {
    this.sdk.tool(
      def.name,
      def.description ?? def.name,
      def.schema instanceof z.ZodObject ? def.schema.shape : {},
      async (args: z.infer<S>) => {
        // The MCP SDK doesn't expose session id in handlers directly;
        // we use a workaround via a context placeholder.
        const ctx: ToolCtx = { worktreeId: null };
        const result = await def.handler(args, ctx);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );
  }

  async start(config: TransportConfig = {}): Promise<{ port: number }> {
    const { transport, port, close } = await createHttpTransport(config);
    this.boundPort = port;
    this.closeFn = close;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.sdk.connect(transport as any);
    return { port };
  }

  async stop(): Promise<void> {
    await this.sdk.close();
    if (this.closeFn) await this.closeFn();
  }

  get port(): number | null {
    return this.boundPort;
  }
}
