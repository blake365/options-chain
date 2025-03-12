import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { TextContent, Resource } from "@modelcontextprotocol/sdk/types.js";
import {
	CallToolRequestSchema,
	ListPromptsRequestSchema,
	ListToolsRequestSchema,
	ListRootsRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

const server = new Server(
	{ name: "options-chain", version: "1.0.0" },
	{
		capabilities: {
			tools: {},
			prompts: {},
			roots: {},
			resources: {},
		},
	},
);

const API_SCHEMAS: Record<string, unknown> = {};

server.setRequestHandler(ListResourcesRequestSchema, async () => {
	const resources: Resource[] = [];
	return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
	const schema = API_SCHEMAS[request.params.uri];
	if (!schema) throw new Error(`Unknown schema: ${request.params.uri}`);

	return {
		contents: [],
	};
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
	return {};
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "find-options-chain",
				description:
					"Query the Tradier API to find options chains based on a symbol on a given expiration date. Limits the results to options with volume, bid, and ask greater than 0.10 and strikes within a percentage of the current price",
				inputSchema: {
					type: "object",
					properties: {
						symbol: {
							type: "string",
							description: "The symbol to find options chains for",
						},
						expiration: {
							type: "string",
							description:
								"The expiration date to find options chains for formatted as YYYY-MM-DD",
						},
						greeks: {
							type: "boolean",
							description: "Whether to include greeks in the response",
							default: true,
						},
						option_type: {
							type: "string",
							description: "The option type to filter by",
							enum: ["call", "put", "both"],
							default: "both",
							optional: true,
						},
						strike_percentage: {
							type: "number",
							description:
								"The percentage of the current price to filter strikes by",
							default: 10,
							optional: true,
						},
					},
				},
			},
			{
				name: "historical-prices",
				description:
					"Query the Tradier API to find historical prices for a given symbol or option contract on in a given time range",
				inputSchema: {
					type: "object",
					properties: {
						symbol: {
							type: "string",
							description:
								"The symbol to find historical prices for either a stock or an option contract. You can fetch historical pricing for options by passing the OCC option symbol (ex. AAPL220617C00270000) as the symbol. Use longer intervals for longer time ranges.",
						},
						interval: {
							type: "string",
							description:
								"Interval of time per timesale. One of: daily, weekly, monthly",
							enum: ["daily", "weekly", "monthly"],
							default: "daily",
						},
						start: {
							type: "string",
							description:
								"The start date of the time range to fetch historical prices for in YYYY-MM-DD format",
						},
						end: {
							type: "string",
							description:
								"The end date of the time range to fetch historical prices for in YYYY-MM-DD format",
						},
						session_filter: {
							type: "string",
							description:
								"Specify to retrieve aggregate data for all hours of the day (all) or only regular trading sessions (open).",
							enum: ["all", "open"],
							default: "all",
							optional: true,
						},
					},
				},
			},
		],
	};
});

/**
 * Calculates the strike price range based on the underlying price and percentage
 * @param underlyingPrice The current price of the underlying asset
 * @param percentage The percentage range to include (e.g., 10 means ±10% from current price)
 * @returns An object with lowerBound and upperBound for strike prices
 */
function filterStrikesByPercentage(
	underlyingPrice: number,
	percentage: number,
): { lowerBound: number; upperBound: number } {
	const lowerBound = underlyingPrice * (1 - percentage / 100);
	const upperBound = underlyingPrice * (1 + percentage / 100);

	return { lowerBound, upperBound };
}

/**
 * Filters strike prices to include only significant price levels based on distance from current price
 * @param underlyingPrice The current price of the underlying asset
 * @param percentage The percentage range to include (e.g., 10 means ±10% from current price)
 * @param strikePrices Array of available strike prices
 * @returns Array of significant strike prices within the percentage range
 */
function filterSignificantStrikePrices(
	underlyingPrice: number,
	percentage: number,
	strikePrices: number[],
): number[] {
	// First filter by the percentage range
	const { lowerBound, upperBound } = filterStrikesByPercentage(
		underlyingPrice,
		percentage,
	);

	// Sort strike prices for consistent processing
	const sortedStrikes = [...strikePrices].sort((a, b) => a - b);

	// Calculate percentage distances from current price
	const strikesWithDistance = sortedStrikes.map((strike) => ({
		strike,
		distance: Math.abs((strike - underlyingPrice) / underlyingPrice) * 100,
	}));

	// Filter based on distance from current price
	return strikesWithDistance
		.filter(({ strike }) => strike >= lowerBound && strike <= upperBound)
		.filter(({ strike, distance }) => {
			// Very close to current price (within 2%) - include all strikes
			if (distance <= 2) {
				return true;
			}

			// Close to current price (2-5%) - include strikes divisible by 2
			if (distance <= 5) {
				return strike % 2 < 0.01 || strike % 2 > 1.99;
			}

			// Medium distance (5-10%) - include strikes divisible by 5 or round numbers
			if (distance <= 10) {
				// For higher priced underlyings (>100), use divisible by 5
				if (underlyingPrice > 100) {
					return strike % 5 < 0.01 || strike % 5 > 4.99;
				}
				// For lower priced underlyings, use divisible by 1
				return Number.isInteger(strike);
			}

			// Far from current price (10-20%) - include strikes divisible by 10 or 5
			if (distance <= 20) {
				// For higher priced underlyings (>100), use divisible by 10
				if (underlyingPrice > 100) {
					return strike % 10 < 0.01 || strike % 10 > 9.99;
				}
				// For lower priced underlyings, use divisible by 5
				return strike % 5 < 0.01 || strike % 5 > 4.99;
			}

			// Very far from current price (>20%) - include only major strikes
			// For higher priced underlyings, use divisible by 50
			if (underlyingPrice > 500) {
				return strike % 50 < 0.01 || strike % 50 > 49.99;
			}
			// For medium priced underlyings, use divisible by 25
			if (underlyingPrice > 100) {
				return strike % 25 < 0.01 || strike % 25 > 24.99;
			}
			// For lower priced underlyings, use divisible by 10
			return strike % 10 < 0.01 || strike % 10 > 9.99;
		})
		.map(({ strike }) => strike);
}

// Add interface for options chain parameters
interface OptionsChainParams {
	symbol: string;
	expiration?: string;
	greeks?: boolean;
	option_type?: "call" | "put" | "both";
	strike_percentage?: number;
}

// Add interface for options chain result structure
interface OptionsChainResult {
	option: OptionData[];
}

// Add interface for option data structure
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

// Add interface for Greeks data structure
interface GreeksData {
	delta: number;
	gamma: number;
	theta: number;
	vega: number;
	mid_iv: number;
}

interface HistoricalPricesParams {
	symbol: string;
	interval: string;
	start: string;
	end: string;
	session_filter: string;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	let responseData: OptionsChainResult | Record<string, unknown> | null = null;

	if (request.params.name === "find-options-chain") {
		const params = request.params.arguments as unknown as OptionsChainParams;

		// Create URL with search parameters
		const searchParams = new URLSearchParams();
		if (params.symbol) searchParams.append("symbol", params.symbol);
		if (params.expiration) searchParams.append("expiration", params.expiration);
		if (params.greeks !== undefined)
			searchParams.append("greeks", params.greeks.toString());

		const quoteUrl = `https://sandbox.tradier.com/v1/markets/quotes?symbols=${params.symbol}`;
		const quoteResponse = await fetch(quoteUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.token}`,
				Accept: "application/json",
			},
		});

		if (!quoteResponse.ok) {
			throw new Error(
				`Failed to fetch quote: ${quoteResponse.statusText} when using params: ${params.symbol}`,
			);
		}

		const quoteData = (await quoteResponse.json()) as Record<string, unknown>;

		// Properly type the quote data structure
		const quotesData = quoteData.quotes as Record<string, unknown> | undefined;
		const quoteArray = Array.isArray(quotesData?.quote)
			? (quotesData?.quote as Record<string, unknown>[])
			: ([quotesData?.quote] as Record<string, unknown>[]);
		const currentPrice = (quoteArray[0]?.last as number) || 0;

		const chainUrl = `https://sandbox.tradier.com/v1/markets/options/chains?${searchParams.toString()}`;

		const chainResponse = await fetch(chainUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.token}`,
				Accept: "application/json",
			},
		});

		if (!chainResponse.ok) {
			throw new Error(
				`Failed to fetch options chain: ${chainResponse.statusText} when using params: ${searchParams.toString()}`,
			);
		}

		const chainData = (await chainResponse.json()) as Record<string, unknown>;

		// once we have the data we need to clean it up before returning it.
		// we need to remove options with no volume, no bid, no ask, or bid and as less then 0.10, also limit strikes to within 20% of the current price
		// we also need to strip out the fields not in the OptionData interface

		// First, type assertion to access the options array
		const chainDataTyped = chainData as Record<string, unknown>;
		const optionsData = chainDataTyped.options as
			| Record<string, unknown>
			| undefined;
		const rawOptions = (optionsData?.option as unknown[]) || [];

		// Map raw options to our OptionData interface, keeping only the fields we want
		const mappedOptions = rawOptions.map((rawOption: unknown) => {
			const option = rawOption as Record<string, unknown>;
			// Extract only the fields defined in our OptionData interface
			const mappedOption: OptionData = {
				symbol: (option.symbol as string) || "",
				description: (option.description as string) || "",
				last: option.last as number | null,
				volume: (option.volume as number) || 0,
				bid: (option.bid as number) || 0,
				ask: (option.ask as number) || 0,
				underlying: (option.underlying as string) || "",
				strike: (option.strike as number) || 0,
				change_percentage: option.change_percentage as number | null,
				open_interest: (option.open_interest as number) || 0,
				expiration_date: (option.expiration_date as string) || "",
				option_type: (option.option_type as string) || "",
			};

			// Only include greeks if they exist
			if (option.greeks) {
				const greeks = option.greeks as Record<string, unknown>;
				mappedOption.greeks = {
					delta: (greeks.delta as number) || 0,
					gamma: (greeks.gamma as number) || 0,
					theta: (greeks.theta as number) || 0,
					vega: (greeks.vega as number) || 0,
					mid_iv: (greeks.mid_iv as number) || 0,
				};
			}

			return mappedOption;
		});

		// Apply basic filters first
		const qualityFilteredOptions = mappedOptions.filter(
			(option: OptionData) => {
				// Filter based on option type
				if (params.option_type === "call" && option.option_type !== "call") {
					return false;
				}
				if (params.option_type === "put" && option.option_type !== "put") {
					return false;
				}

				// Basic quality filters - apply to all options
				return option.volume > 0 && option.bid > 0.1 && option.ask > 0.1;
			},
		);

		// Default strike percentage if not provided
		const strikePercentage =
			params.strike_percentage !== undefined
				? Math.max(0, Math.min(100, params.strike_percentage)) // Ensure value is between 0 and 100
				: 20;

		// Extract all available strike prices
		const allStrikes = qualityFilteredOptions.map((option) => option.strike);

		// Filter to only include significant strike prices
		const significantStrikes = filterSignificantStrikePrices(
			currentPrice,
			strikePercentage,
			allStrikes,
		);

		// Final filtering to only include options with significant strike prices
		const filteredOptions = qualityFilteredOptions.filter((option) =>
			significantStrikes.includes(option.strike),
		);

		// Return the options chain data with proper structure
		responseData = { option: filteredOptions };
	}

	if (request.params.name === "historical-prices") {
		const params = request.params
			.arguments as unknown as HistoricalPricesParams;

		const searchParams = new URLSearchParams();
		if (params.symbol) searchParams.append("symbol", params.symbol);
		if (params.interval) searchParams.append("interval", params.interval);
		if (params.start) searchParams.append("start", params.start);
		if (params.end) searchParams.append("end", params.end);
		if (params.session_filter)
			searchParams.append("session_filter", params.session_filter);

		const historicalPricesUrl = `https://sandbox.tradier.com/v1/markets/history?${searchParams.toString()}`;

		const historicalPricesResponse = await fetch(historicalPricesUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.token}`,
				Accept: "application/json",
			},
		});

		if (!historicalPricesResponse.ok) {
			throw new Error(
				`Failed to fetch historical prices: ${historicalPricesResponse.statusText} when using params: ${searchParams.toString()}`,
			);
		}

		const historicalPricesData =
			(await historicalPricesResponse.json()) as Record<string, unknown>;

		// the data is already in the format we want, so we can just return it
		responseData = historicalPricesData;
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(responseData, null, 2),
			} as TextContent,
		],
	};
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

/**
 * Test function to demonstrate how filterSignificantStrikePrices works
 * This is for development/debugging purposes only
 */
function testSignificantStrikePrices() {
	// Example: SPY at 556
	const underlyingPrice = 556;
	const percentage = 10; // 10% range

	// Generate a range of strike prices (simulating available strikes)
	const strikePrices: number[] = [];
	for (let i = 500; i <= 610; i++) {
		// Add strikes in $1 increments
		strikePrices.push(i);
	}

	// Filter to significant strikes only
	const significantStrikes = filterSignificantStrikePrices(
		underlyingPrice,
		percentage,
		strikePrices,
	);

	console.log(`Underlying price: $${underlyingPrice}`);
	console.log(`Percentage range: ${percentage}%`);
	console.log(`Total available strikes: ${strikePrices.length}`);
	console.log(`Filtered significant strikes: ${significantStrikes.length}`);
	console.log("Significant strikes:", significantStrikes.join(", "));

	// Calculate reduction percentage
	const reductionPct =
		((strikePrices.length - significantStrikes.length) / strikePrices.length) *
		100;
	console.log(`Strike reduction: ${reductionPct.toFixed(1)}%`);
}

// Uncomment to run the test
// testSignificantStrikePrices();

main().catch((err) => {
	console.error("Error starting server:", err);
	process.exit(1);
});
