#!/usr/bin/env node
/**
 * STDIO entry point — what `npx options-chain-mcp` and Claude Desktop run.
 *
 * src/worker.ts is the Cloudflare Workers entry point; both share the tool
 * definitions in src/tools.ts and the provider abstraction in src/providers/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProvider, type ProviderEnv } from "./providers/factory.js";
import { registerTools, type LogFn } from "./tools.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

const server = new McpServer(
	{ name: SERVER_NAME, version: SERVER_VERSION },
	{ capabilities: { tools: {}, logging: {} } },
);

const safeLog: LogFn = (level, data) => {
	try {
		server.server.sendLoggingMessage({ level, data });
	} catch {
		// pre-connect or protocol mismatch — swallow
	}
};

// stdout carries the MCP protocol, but stderr is free for diagnostics and is
// what Claude Desktop surfaces in its logs. Failing silently here left users
// with a server that just never appeared.
function fatal(message: string): never {
	console.error(`options-chain-mcp: ${message}`);
	process.exit(1);
}

let provider;
try {
	provider = createProvider(process.env as ProviderEnv);
} catch (error) {
	fatal(
		`${error instanceof Error ? error.message : String(error)}\n` +
			"Set TRADIER_TOKEN, or ALPACA_API_KEY_ID and ALPACA_SECRET_KEY, in the server environment.",
	);
}

registerTools(server, provider, safeLog);

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
	fatal(`failed to start: ${error instanceof Error ? error.message : String(error)}`);
});
