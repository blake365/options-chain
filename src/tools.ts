import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
	MarketDataProvider,
	OptionData,
	OptionsChainResult,
} from "./providers/types.js";

export type LogFn = (
	level: "info" | "error" | "debug" | "warning",
	data: string,
) => void;

const noopLog: LogFn = () => {};

function filterSignificantStrikePrices(
	underlyingPrice: number,
	percentage: number,
	strikePrices: number[],
): number[] {
	const lowerBound = underlyingPrice * (1 - percentage / 100);
	const upperBound = underlyingPrice * (1 + percentage / 100);
	const sorted = [...strikePrices].sort((a, b) => a - b);
	return sorted
		.map((strike) => ({
			strike,
			distance: Math.abs((strike - underlyingPrice) / underlyingPrice) * 100,
		}))
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

function filterChainForLlm(
	chain: OptionsChainResult,
	opts: {
		option_type: "call" | "put" | "both";
		strike_percentage: number;
	},
): OptionData[] {
	const quality = chain.options.filter((o) => {
		if (opts.option_type === "call" && o.option_type !== "call") return false;
		if (opts.option_type === "put" && o.option_type !== "put") return false;
		// "Real market interest" — volume for Tradier (daily total), open
		// interest for Alpaca (its snapshot has no daily volume; volume is
		// null there). Either signal is enough to keep the strike.
		const hasInterest = (o.volume ?? 0) > 0 || o.open_interest > 0;
		return hasInterest && o.bid > 0.1 && o.ask > 0.1;
	});

	if (chain.underlying_price <= 0) return quality;

	const pct = Math.max(0, Math.min(100, opts.strike_percentage));
	const significant = new Set(
		filterSignificantStrikePrices(
			chain.underlying_price,
			pct,
			quality.map((o) => o.strike),
		),
	);
	return quality.filter((o) => significant.has(o.strike));
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
	provider: MarketDataProvider,
	log: LogFn = noopLog,
) {
	server.tool(
		"find-options-chain",
		"Query the data provider for the options chain of a symbol on a specific expiration date. The result is filtered to options with volume, bid, and ask greater than 0.10 and strikes within a configurable percentage of the underlying price. If nothing is found the result may be empty — check that the symbol and expiration are valid.",
		{
			symbol: z.string().describe("The underlying symbol"),
			expiration: z
				.string()
				.describe("Expiration date formatted as YYYY-MM-DD"),
			greeks: z
				.boolean()
				.default(true)
				.describe("Whether to include greeks/IV in the response"),
			option_type: z
				.enum(["call", "put", "both"])
				.default("both")
				.describe("Filter by option type"),
			strike_percentage: z
				.number()
				.default(10)
				.describe(
					"Percentage distance from the underlying price to include strikes (e.g. 10 = ±10%)",
				),
		},
		async (args) => {
			log("info", `find-options-chain: ${JSON.stringify(args)}`);
			const chain = await provider.getOptionsChain(args);
			const filtered = filterChainForLlm(chain, args);
			log(
				"info",
				`returning ${filtered.length} options (underlying ${chain.underlying_price})`,
			);
			return asText({
				underlying_price: chain.underlying_price,
				option: filtered,
			});
		},
	);

	server.tool(
		"historical-prices",
		"Historical OHLCV bars for a stock symbol or OCC option contract over a time range.",
		{
			symbol: z
				.string()
				.describe(
					"Stock symbol or OCC option contract (e.g. AAPL or AAPL250117C00150000). Use longer intervals for longer ranges.",
				),
			interval: z
				.enum(["daily", "weekly", "monthly"])
				.default("daily")
				.describe("Bar interval"),
			start: z.string().describe("Start date in YYYY-MM-DD"),
			end: z.string().describe("End date in YYYY-MM-DD"),
			session_filter: z
				.enum(["all", "open"])
				.default("all")
				.describe(
					"Include extended-hours bars (all) or regular sessions only (open). Applies only to Tradier; Alpaca ignores this.",
				),
		},
		async (args) => {
			log("info", `historical-prices: ${JSON.stringify(args)}`);
			const result = await provider.getHistoricalPrices(args);
			return asText(result);
		},
	);

	server.tool(
		"find-option-expirations",
		"List valid option expiration dates for an underlying symbol.",
		{
			symbol: z.string().describe("Underlying symbol"),
		},
		async (args) => {
			log("info", `find-option-expirations: ${JSON.stringify(args)}`);
			const expirations = await provider.getOptionExpirations(args.symbol);
			return asText({ expirations });
		},
	);

	server.tool(
		"get-quote",
		"Get the latest quote for a stock symbol or single OCC option contract. For option symbols the response includes Greeks and implied volatility when the provider supports it.",
		{
			symbol: z
				.string()
				.describe(
					"Stock symbol (e.g. AAPL) or OCC option contract (e.g. AAPL250117C00150000).",
				),
		},
		async (args) => {
			log("info", `get-quote: ${JSON.stringify(args)}`);
			const quote = await provider.getQuote(args.symbol, { greeks: true });
			return asText(quote);
		},
	);
}
