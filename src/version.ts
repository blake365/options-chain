/**
 * Single source of truth for the version reported over MCP.
 *
 * Both entry points import this. It is a literal rather than a read of
 * package.json because src/worker.ts is bundled by wrangler for Cloudflare
 * Workers, where there is no filesystem to read from at runtime.
 *
 * Keep in sync with the "version" field in package.json.
 */
export const SERVER_VERSION = "1.2.0";
export const SERVER_NAME = "options-chain";
