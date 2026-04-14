import { isOccOptionSymbol, } from "./types.js";
const DEFAULT_BASE = "https://sandbox.tradier.com/v1";
export class TradierProvider {
    token;
    baseUrl;
    name = "tradier";
    constructor(token, baseUrl = DEFAULT_BASE) {
        this.token = token;
        this.baseUrl = baseUrl;
    }
    headers() {
        return {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
        };
    }
    async fetchJson(path, params) {
        const res = await fetch(`${this.baseUrl}${path}?${params}`, {
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`Tradier ${path}: ${res.status} ${res.statusText}`);
        }
        return (await res.json());
    }
    async getQuote(symbol) {
        const data = await this.fetchJson("/markets/quotes", new URLSearchParams({ symbols: symbol }));
        const quotes = data.quotes;
        if (!quotes)
            return null;
        const qRaw = Array.isArray(quotes.quote) ? quotes.quote[0] : quotes.quote;
        if (!qRaw)
            return null;
        const q = qRaw;
        const kind = isOccOptionSymbol(symbol)
            ? "option"
            : "stock";
        const base = {
            symbol: q.symbol ?? symbol,
            kind,
            last: q.last ?? null,
            bid: q.bid ?? null,
            ask: q.ask ?? null,
            volume: q.volume ?? undefined,
            change_percentage: q.change_percentage ?? null,
        };
        if (kind === "option") {
            base.underlying = q.underlying;
            base.strike = q.strike ?? undefined;
            base.expiration = q.expiration_date;
            const typ = q.option_type;
            if (typ === "call" || typ === "put")
                base.option_type = typ;
        }
        return base;
    }
    async getOptionsChain(params) {
        const underlyingQuote = await this.getQuote(params.symbol);
        const underlyingPrice = underlyingQuote?.last ?? 0;
        const search = new URLSearchParams({
            symbol: params.symbol,
            expiration: params.expiration,
            greeks: String(params.greeks),
        });
        const data = await this.fetchJson("/markets/options/chains", search);
        const options = data.options;
        const raw = options?.option || [];
        const mapped = raw.map((item) => {
            const o = item;
            const out = {
                symbol: o.symbol || "",
                description: o.description || "",
                last: o.last ?? null,
                volume: o.volume || 0,
                bid: o.bid || 0,
                ask: o.ask || 0,
                underlying: o.underlying || "",
                strike: o.strike || 0,
                change_percentage: o.change_percentage ?? null,
                open_interest: o.open_interest || 0,
                expiration_date: o.expiration_date || "",
                option_type: o.option_type || "",
            };
            if (o.greeks) {
                const g = o.greeks;
                out.greeks = {
                    delta: g.delta || 0,
                    gamma: g.gamma || 0,
                    theta: g.theta || 0,
                    vega: g.vega || 0,
                    mid_iv: g.mid_iv || 0,
                };
            }
            return out;
        });
        return { underlying_price: underlyingPrice, options: mapped };
    }
    async getHistoricalPrices(params) {
        const search = new URLSearchParams({
            symbol: params.symbol,
            interval: params.interval,
            start: params.start,
            end: params.end,
            session_filter: params.session_filter,
        });
        const data = await this.fetchJson("/markets/history", search);
        const history = data.history;
        const rawDays = history?.day;
        const dayArr = Array.isArray(rawDays) ? rawDays : rawDays ? [rawDays] : [];
        const bars = dayArr.map((d) => ({
            date: d.date ?? "",
            open: Number(d.open ?? 0),
            high: Number(d.high ?? 0),
            low: Number(d.low ?? 0),
            close: Number(d.close ?? 0),
            volume: Number(d.volume ?? 0),
        }));
        return { symbol: params.symbol, interval: params.interval, bars };
    }
    async getOptionExpirations(symbol) {
        const search = new URLSearchParams({
            symbol,
            includeAllRoots: "true",
            expirationType: "true",
        });
        const data = await this.fetchJson("/markets/options/expirations", search);
        const expirations = data.expirations;
        const raw = expirations?.expiration;
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        return arr
            .map((e) => e.date)
            .filter((d) => typeof d === "string");
    }
}
