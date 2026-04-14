import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type LogFn = (
	level: "info" | "error" | "debug" | "warning",
	data: string,
) => void;

const noopLog: LogFn = () => {};

export interface ToolEnv {
	token: string;
}

interface GreeksData {
	delta: number;
	gamma: number;
	theta: number;
	vega: number;
	mid_iv: number;
}

interface OptionData {
	symbol: string;
	description: string;
	last: number | null;
	volume: number;
	bid: number;
	ask: number;
	underlying: string;
	strike: number;
	change_percentage: number | null;
	open_interest: number;
	expiration_date: string;
	option_type: string;
	greeks?: GreeksData;
}

const TRADIER_BASE = "https://sandbox.tradier.com/v1";

function authHeaders(token: string) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
	};
}

function filterStrikesByPercentage(
	underlyingPrice: number,
	percentage: number,
): { lowerBound: number; upperBound: number } {
	return {
		lowerBound: underlyingPrice * (1 - percentage / 100),
		upperBound: underlyingPrice * (1 + percentage / 100),
	};
}

function filterSignificantStrikePrices(
	underlyingPrice: number,
	percentage: number,
	strikePrices: number[],
): number[] {
	const { lowerBound, upperBound } = filterStrikesByPercentage(
		underlyingPrice,
		percentage,
	);

	const sorted = [...strikePrices].sort((a, b) => a - b);
	const withDistance = sorted.map((strike) => ({
		strike,
		distance: Math.abs((strike - underlyingPrice) / underlyingPrice) * 100,
	}));

	return withDistance
		.filter(({ strike }) => strike >= lowerBound && strike <= upperBound)
		.filter(({ strike, distance }) => {
			if (distance <= 2) return true;
			if (distance <= 5) return strike % 2 < 0.01 || strike % 2 > 1.99;
			if (distance <= 10) {
				if (underlyingPrice > 100)
					return strike % 5 < 0.01 || strike % 5 > 4.99;
				return Number.isInteger(strike);
			}
			if (distance <= 20) {
				if (underlyingPrice > 100)
					return strike % 10 < 0.01 || strike % 10 > 9.99;
				return strike % 5 < 0.01 || strike % 5 > 4.99;
			}
			if (underlyingPrice > 500)
				return strike % 50 < 0.01 || strike % 50 > 49.99;
			if (underlyingPrice > 100)
				return strike % 25 < 0.01 || strike % 25 > 24.99;
			return strike % 10 < 0.01 || strike % 10 > 9.99;
		})
		.map(({ strike }) => strike);
}

function asText(data: unknown) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(data, null, 2) },
		],
	};
}

export function registerTools(
	server: McpServer,
	env: ToolEnv,
	log: LogFn = noopLog,
) {
	server.tool(
		"find-options-chain",
		"Query the Tradier API to find options chains based on a symbol on a given expiration date. Limits the results to options with volume, bid, and ask greater than 0.10 and strikes within a percentage of the current price. If nothing is found, the tool will return null which could indicate that the symbol or the expiration date is not valid.",
		{
			symbol: z.string().describe("The symbol to find options chains for"),
			expiration: z
				.string()
				.describe(
					"The expiration date to find options chains for formatted as YYYY-MM-DD",
				),
			greeks: z
				.boolean()
				.default(true)
				.describe("Whether to include greeks in the response"),
			option_type: z
				.enum(["call", "put", "both"])
				.default("both")
				.describe("The option type to filter by"),
			strike_percentage: z
				.number()
				.default(10)
				.describe("The percentage of the current price to filter strikes by"),
		},
		async (args) => {
			log("info", `find-options-chain: ${JSON.stringify(args)}`);

			if (!env.token) throw new Error("Tradier API token is missing.");

			const quoteUrl = `${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(args.symbol)}`;
			const quoteRes = await fetch(quoteUrl, {
				headers: authHeaders(env.token),
			});
			if (!quoteRes.ok)
				throw new Error(
					`Failed to fetch quote: ${quoteRes.status} ${quoteRes.statusText}`,
				);
			const quoteData = (await quoteRes.json()) as Record<string, unknown>;
			const quotes = quoteData.quotes as Record<string, unknown> | undefined;
			const quoteArray = Array.isArray(quotes?.quote)
				? (quotes?.quote as Record<string, unknown>[])
				: ([quotes?.quote] as Record<string, unknown>[]);
			const currentPrice = (quoteArray[0]?.last as number) || 0;
			log("info", `current price for ${args.symbol}: ${currentPrice}`);

			const chainParams = new URLSearchParams({
				symbol: args.symbol,
				expiration: args.expiration,
				greeks: String(args.greeks),
			});
			const chainUrl = `${TRADIER_BASE}/markets/options/chains?${chainParams}`;
			const chainRes = await fetch(chainUrl, {
				headers: authHeaders(env.token),
			});
			if (!chainRes.ok)
				throw new Error(
					`Failed to fetch options chain: ${chainRes.status} ${chainRes.statusText}`,
				);
			const chainData = (await chainRes.json()) as Record<string, unknown>;
			const optionsObj = chainData.options as
				| Record<string, unknown>
				| undefined;
			const rawOptions = (optionsObj?.option as unknown[]) || [];

			const mapped: OptionData[] = rawOptions.map((raw) => {
				const o = raw as Record<string, unknown>;
				const m: OptionData = {
					symbol: (o.symbol as string) || "",
					description: (o.description as string) || "",
					last: o.last as number | null,
					volume: (o.volume as number) || 0,
					bid: (o.bid as number) || 0,
					ask: (o.ask as number) || 0,
					underlying: (o.underlying as string) || "",
					strike: (o.strike as number) || 0,
					change_percentage: o.change_percentage as number | null,
					open_interest: (o.open_interest as number) || 0,
					expiration_date: (o.expiration_date as string) || "",
					option_type: (o.option_type as string) || "",
				};
				if (o.greeks) {
					const g = o.greeks as Record<string, unknown>;
					m.greeks = {
						delta: (g.delta as number) || 0,
						gamma: (g.gamma as number) || 0,
						theta: (g.theta as number) || 0,
						vega: (g.vega as number) || 0,
						mid_iv: (g.mid_iv as number) || 0,
					};
				}
				return m;
			});

			const qualityFiltered = mapped.filter((o) => {
				if (args.option_type === "call" && o.option_type !== "call")
					return false;
				if (args.option_type === "put" && o.option_type !== "put") return false;
				return o.volume > 0 && o.bid > 0.1 && o.ask > 0.1;
			});

			const strikePct = Math.max(0, Math.min(100, args.strike_percentage));
			const significant = filterSignificantStrikePrices(
				currentPrice,
				strikePct,
				qualityFiltered.map((o) => o.strike),
			);
			const filtered = qualityFiltered.filter((o) =>
				significant.includes(o.strike),
			);

			log("info", `returning ${filtered.length} options`);
			return asText({ option: filtered });
		},
	);

	server.tool(
		"historical-prices",
		"Query the Tradier API to find historical prices for a given symbol or option contract on in a given time range",
		{
			symbol: z
				.string()
				.describe(
					"The symbol to find historical prices for either a stock or an option contract. You can fetch historical pricing for options by passing the OCC option symbol (ex. AAPL220617C00270000) as the symbol. Use longer intervals for longer time ranges.",
				),
			interval: z
				.enum(["daily", "weekly", "monthly"])
				.default("daily")
				.describe("Interval of time per timesale."),
			start: z
				.string()
				.describe(
					"The start date of the time range to fetch historical prices for in YYYY-MM-DD format",
				),
			end: z
				.string()
				.describe(
					"The end date of the time range to fetch historical prices for in YYYY-MM-DD format",
				),
			session_filter: z
				.enum(["all", "open"])
				.default("all")
				.describe(
					"Specify to retrieve aggregate data for all hours of the day (all) or only regular trading sessions (open).",
				),
		},
		async (args) => {
			log("info", `historical-prices: ${JSON.stringify(args)}`);
			if (!env.token) throw new Error("Tradier API token is missing.");

			const params = new URLSearchParams({
				symbol: args.symbol,
				interval: args.interval,
				start: args.start,
				end: args.end,
				session_filter: args.session_filter,
			});
			const url = `${TRADIER_BASE}/markets/history?${params}`;
			const res = await fetch(url, { headers: authHeaders(env.token) });
			if (!res.ok)
				throw new Error(
					`Failed to fetch historical prices: ${res.status} ${res.statusText}`,
				);
			const data = (await res.json()) as Record<string, unknown>;
			return asText(data);
		},
	);

	server.tool(
		"find-option-expirations",
		"Query the Tradier API to find all option expirations for a given symbol. This is useful for finding expiration dates that can be used in the find-options-chain tool.",
		{
			symbol: z
				.string()
				.describe("The underlying symbol to find option expirations for"),
		},
		async (args) => {
			log("info", `find-option-expirations: ${JSON.stringify(args)}`);
			if (!env.token) throw new Error("Tradier API token is missing.");

			const params = new URLSearchParams({
				symbol: args.symbol,
				includeAllRoots: "true",
				expirationType: "true",
			});
			const url = `${TRADIER_BASE}/markets/options/expirations?${params}`;
			const res = await fetch(url, { headers: authHeaders(env.token) });
			if (!res.ok)
				throw new Error(
					`Failed to fetch option expirations: ${res.status} ${res.statusText}`,
				);
			const data = (await res.json()) as Record<string, unknown>;
			return asText({ expirations: data.expirations });
		},
	);
}
