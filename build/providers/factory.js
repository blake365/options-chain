import { AlpacaProvider } from "./alpaca.js";
import { TradierProvider } from "./tradier.js";
function pickName(env) {
    const explicit = env.DATA_PROVIDER?.toLowerCase();
    if (explicit === "alpaca" || explicit === "tradier")
        return explicit;
    if (env.ALPACA_API_KEY_ID && env.ALPACA_SECRET_KEY)
        return "alpaca";
    return "tradier";
}
export function createProvider(env) {
    const name = pickName(env);
    if (name === "alpaca") {
        if (!env.ALPACA_API_KEY_ID || !env.ALPACA_SECRET_KEY) {
            throw new Error("Alpaca provider selected but ALPACA_API_KEY_ID and ALPACA_SECRET_KEY are not set.");
        }
        return new AlpacaProvider({
            keyId: env.ALPACA_API_KEY_ID,
            secret: env.ALPACA_SECRET_KEY,
            optionsFeed: env.ALPACA_OPTIONS_FEED,
            stockFeed: env.ALPACA_STOCK_FEED,
            tradingBase: env.ALPACA_TRADING_BASE,
        });
    }
    const token = env.TRADIER_TOKEN ?? env.token;
    if (!token) {
        throw new Error("Tradier provider selected but TRADIER_TOKEN is not set.");
    }
    return new TradierProvider(token, env.TRADIER_BASE_URL);
}
