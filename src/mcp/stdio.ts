import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRepointelServer } from "./server.js";

/**
 * Start the repointel MCP server on stdio.
 * Nothing may be written to stdout except protocol traffic.
 */
export async function startStdioServer(): Promise<void> {
  const server = createRepointelServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
