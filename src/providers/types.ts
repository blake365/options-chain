export interface GreeksData {
	delta: number;
	gamma: number;
	theta: number;
	vega: number;
	mid_iv: number;
}

export interface OptionData {
	symbol: string;
	description: string;
	last: number | null;
	/** Daily volume. `null` means the provider does not expose it (not "no activity"). */
	volume: number | null;
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

export interface Quote {
	symbol: string;
	kind: "stock" | "option";
	last: number | null;
	bid: number | null;
	ask: number | null;
	volume?: number;
	change_percentage?: number | null;
	underlying?: string;
	strike?: number;
	expiration?: string;
	option_type?: "call" | "put";
	greeks?: GreeksData;
	implied_volatility?: number | null;
}

export interface Bar {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface HistoricalResult {
	symbol: string;
	interval: string;
	bars: Bar[];
}

export interface OptionsChainParams {
	symbol: string;
	expiration: string;
	greeks: boolean;
	option_type: "call" | "put" | "both";
	strike_percentage: number;
}

export interface OptionsChainResult {
	underlying_price: number;
	options: OptionData[];
}

export interface HistoricalParams {
	symbol: string;
	interval: "daily" | "weekly" | "monthly";
	start: string;
	end: string;
	session_filter: "all" | "open";
}

export type ProviderName = "tradier" | "alpaca";

export interface MarketDataProvider {
	readonly name: ProviderName;
	getQuote(symbol: string, opts?: { greeks?: boolean }): Promise<Quote | null>;
	getOptionsChain(params: OptionsChainParams): Promise<OptionsChainResult>;
	getHistoricalPrices(params: HistoricalParams): Promise<HistoricalResult>;
	getOptionExpirations(symbol: string): Promise<string[]>;
}

const OCC_SYMBOL_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;

export function isOccOptionSymbol(symbol: string): boolean {
	return OCC_SYMBOL_RE.test(symbol);
}
