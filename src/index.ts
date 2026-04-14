import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProvider, type ProviderEnv } from "./providers/factory.js";
import { registerTools, type LogFn } from "./tools.js";

const server = new McpServer(
	{ name: "options-chain", version: "1.2.0" },
	{ capabilities: { tools: {}, logging: {} } },
);

const safeLog: LogFn = (level, data) => {
	try {
		server.server.sendLoggingMessage({ level, data });
	} catch {
		// pre-connect or protocol mismatch — swallow
	}
};

let provider;
try {
	provider = createProvider(process.env as ProviderEnv);
} catch (err) {
	// no valid credentials — exit silently (stdio protocol can't log pre-connect)
	process.exit(1);
}

registerTools(server, provider, safeLog);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch(() => process.exit(1));
