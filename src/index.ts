import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, type LogFn } from "./tools.js";

const server = new McpServer(
	{ name: "options-chain", version: "1.0.1" },
	{ capabilities: { tools: {}, logging: {} } },
);

const safeLog: LogFn = (level, data) => {
	try {
		server.server.sendLoggingMessage({ level, data });
	} catch {
		// pre-connect or protocol mismatch — swallow
	}
};

const token = process.env.TRADIER_TOKEN ?? process.env.token;
if (!token) {
	process.exit(1);
}

registerTools(server, { token }, safeLog);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(() => process.exit(1));
