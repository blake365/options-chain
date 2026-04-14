import { AlpacaProvider } from "./alpaca.js";
import { TradierProvider } from "./tradier.js";
import type { MarketDataProvider, ProviderName } from "./types.js";

export interface ProviderEnv {
	DATA_PROVIDER?: string;
	TRADIER_TOKEN?: string;
	TRADIER_BASE_URL?: string;
	ALPACA_API_KEY_ID?: string;
	ALPACA_SECRET_KEY?: string;
	ALPACA_OPTIONS_FEED?: string;
	ALPACA_STOCK_FEED?: string;
	ALPACA_TRADING_BASE?: string;
	token?: string;
}

function pickName(env: ProviderEnv): ProviderName {
	const explicit = env.DATA_PROVIDER?.toLowerCase();
	if (explicit === "alpaca" || explicit === "tradier") return explicit;
	if (env.ALPACA_API_KEY_ID && env.ALPACA_SECRET_KEY) return "alpaca";
	return "tradier";
}

export function createProvider(env: ProviderEnv): MarketDataProvider {
	const name = pickName(env);
	if (name === "alpaca") {
		if (!env.ALPACA_API_KEY_ID || !env.ALPACA_SECRET_KEY) {
			throw new Error(
				"Alpaca provider selected but ALPACA_API_KEY_ID and ALPACA_SECRET_KEY are not set.",
			);
		}
		return new AlpacaProvider({
			keyId: env.ALPACA_API_KEY_ID,
			secret: env.ALPACA_SECRET_KEY,
			optionsFeed: env.ALPACA_OPTIONS_FEED as "indicative" | "opra" | undefined,
			stockFeed: env.ALPACA_STOCK_FEED as
				| "iex"
				| "delayed_sip"
				| "sip"
				| undefined,
			tradingBase: env.ALPACA_TRADING_BASE,
		});
	}
	const token = env.TRADIER_TOKEN ?? env.token;
	if (!token) {
		throw new Error(
			"Tradier provider selected but TRADIER_TOKEN is not set.",
		);
	}
	return new TradierProvider(token, env.TRADIER_BASE_URL);
}
