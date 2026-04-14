import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

export interface Env {
	TRADIER_TOKEN: string;
	MCP_AUTH_TOKEN: string;
	MCP_OBJECT: DurableObjectNamespace;
}

export class OptionsChainMCP extends McpAgent<Env> {
	server = new McpServer(
		{ name: "options-chain", version: "1.0.1" },
		{ capabilities: { tools: {}, logging: {} } },
	);

	async init() {
		registerTools(
			this.server,
			{ token: this.env.TRADIER_TOKEN },
			(level, data) => console.log(`[${level}] ${data}`),
		);
	}
}

function unauthorized() {
	return new Response("Unauthorized", {
		status: 401,
		headers: { "WWW-Authenticate": 'Bearer realm="options-chain-mcp"' },
	});
}

function isAuthorized(req: Request, env: Env) {
	if (!env.MCP_AUTH_TOKEN) return false;
	const header = req.headers.get("Authorization");
	return header === `Bearer ${env.MCP_AUTH_TOKEN}`;
}

export default {
	async fetch(
		req: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		if (!isAuthorized(req, env)) return unauthorized();

		const url = new URL(req.url);

		if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
			return OptionsChainMCP.serveSSE("/sse").fetch(req, env, ctx);
		}
		if (url.pathname === "/mcp") {
			return OptionsChainMCP.serve("/mcp").fetch(req, env, ctx);
		}
		return new Response("Not found", { status: 404 });
	},
};
