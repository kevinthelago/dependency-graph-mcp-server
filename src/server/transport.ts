import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface TransportConfig {
  host?: string;
  port?: number;
}

export interface BoundTransport {
  transport: StreamableHTTPServerTransport;
  port: number;
  close(): Promise<void>;
}

export async function createHttpTransport(
  config: TransportConfig = {},
): Promise<BoundTransport> {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 0; // 0 = OS picks a free port

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void transport.handleRequest(req, res);
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.once("error", reject);
  });

  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    transport,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
