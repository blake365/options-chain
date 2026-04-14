import OAuthProvider, {
	type AuthRequest,
	type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider } from "./providers/factory.js";
import { registerTools } from "./tools.js";

export interface Env {
	DATA_PROVIDER?: string;
	TRADIER_TOKEN?: string;
	TRADIER_BASE_URL?: string;
	ALPACA_API_KEY_ID?: string;
	ALPACA_SECRET_KEY?: string;
	ALPACA_OPTIONS_FEED?: string;
	ALPACA_STOCK_FEED?: string;
	ALPACA_TRADING_BASE?: string;
	APPROVE_PASSCODE: string;
	MCP_OBJECT: DurableObjectNamespace;
	OAUTH_KV: KVNamespace;
	OAUTH_PROVIDER: OAuthHelpers;
}

type Props = { userId: string };

export class OptionsChainMCP extends McpAgent<Env, unknown, Props> {
	server = new McpServer(
		{ name: "options-chain", version: "1.2.0" },
		{ capabilities: { tools: {}, logging: {} } },
	);

	async init() {
		const provider = createProvider(this.env);
		registerTools(this.server, provider, (level, data) =>
			console.log(`[${level}] [${provider.name}] ${data}`),
		);
	}
}

function escapeHtml(s: string) {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c] as string,
	);
}

function renderConsentPage(opts: {
	clientName: string;
	stateB64: string;
	error?: string;
}) {
	const name = escapeHtml(opts.clientName);
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>Authorize ${name}</title>
	<style>
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			margin: 0;
			min-height: 100vh;
			display: grid;
			place-items: center;
			background: canvas;
			color: canvastext;
			padding: 1rem;
		}
		.card {
			max-width: 24rem;
			width: 100%;
			padding: 2rem;
			border: 1px solid color-mix(in srgb, canvastext 15%, transparent);
			border-radius: 12px;
			background: color-mix(in srgb, canvas 100%, canvastext 2%);
		}
		h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
		p { margin: 0 0 1.5rem; color: color-mix(in srgb, canvastext 70%, transparent); font-size: 0.9rem; line-height: 1.5; }
		label { display: block; font-size: 0.85rem; margin-bottom: 0.5rem; }
		input[type=password] {
			width: 100%;
			padding: 0.625rem 0.75rem;
			border: 1px solid color-mix(in srgb, canvastext 25%, transparent);
			border-radius: 6px;
			background: canvas;
			color: canvastext;
			font-size: 1rem;
			margin-bottom: 1rem;
		}
		input[type=password]:focus { outline: 2px solid color-mix(in srgb, canvastext 40%, transparent); outline-offset: 1px; border-color: transparent; }
		button {
			width: 100%;
			padding: 0.625rem;
			border: 0;
			border-radius: 6px;
			background: canvastext;
			color: canvas;
			font-size: 0.95rem;
			font-weight: 500;
			cursor: pointer;
		}
		button:hover { opacity: 0.9; }
		.error {
			padding: 0.625rem 0.75rem;
			border-radius: 6px;
			background: color-mix(in srgb, #dc2626 15%, transparent);
			color: #dc2626;
			font-size: 0.85rem;
			margin-bottom: 1rem;
		}
	</style>
</head>
<body>
	<form class="card" method="post" action="/authorize">
		<h1>Authorize ${name}</h1>
		<p>Grant this client access to your options-chain MCP server. Enter the passcode to continue.</p>
		${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
		<label for="passcode">Passcode</label>
		<input id="passcode" type="password" name="passcode" autofocus autocomplete="off" required>
		<input type="hidden" name="state" value="${escapeHtml(opts.stateB64)}">
		<button type="submit">Approve</button>
	</form>
</body>
</html>`;
}

async function handleAuthorize(req: Request, env: Env): Promise<Response> {
	if (req.method === "GET") {
		const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(req);
		const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
		return new Response(
			renderConsentPage({
				clientName: client?.clientName ?? oauthReq.clientId,
				stateB64: btoa(JSON.stringify(oauthReq)),
			}),
			{ headers: { "content-type": "text/html; charset=utf-8" } },
		);
	}

	if (req.method === "POST") {
		const form = await req.formData();
		const passcode = form.get("passcode");
		const stateB64 = form.get("state");
		if (typeof stateB64 !== "string") {
			return new Response("Bad request", { status: 400 });
		}

		let oauthReq: AuthRequest;
		try {
			oauthReq = JSON.parse(atob(stateB64));
		} catch {
			return new Response("Bad request", { status: 400 });
		}

		if (!env.APPROVE_PASSCODE || passcode !== env.APPROVE_PASSCODE) {
			const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
			return new Response(
				renderConsentPage({
					clientName: client?.clientName ?? oauthReq.clientId,
					stateB64,
					error: "Wrong passcode.",
				}),
				{
					status: 403,
					headers: { "content-type": "text/html; charset=utf-8" },
				},
			);
		}

		const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			request: oauthReq,
			userId: "owner",
			metadata: {},
			scope: oauthReq.scope,
			props: { userId: "owner" },
		});
		return Response.redirect(redirectTo, 302);
	}

	return new Response("Method not allowed", { status: 405 });
}

const defaultHandler = {
	async fetch(
		req: Request,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/authorize") return handleAuthorize(req, env);
		return new Response("Not found", { status: 404 });
	},
};

export default new OAuthProvider({
	apiHandlers: {
		"/sse": OptionsChainMCP.serveSSE("/sse"),
		"/mcp": OptionsChainMCP.serve("/mcp"),
	},
	defaultHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
