import {
	isOccOptionSymbol,
	type Bar,
	type GreeksData,
	type HistoricalParams,
	type HistoricalResult,
	type MarketDataProvider,
	type OptionData,
	type OptionsChainParams,
	type OptionsChainResult,
	type Quote,
} from "./types.js";

const DEFAULT_BASE = "https://sandbox.tradier.com/v1";

export class TradierProvider implements MarketDataProvider {
	readonly name = "tradier" as const;

	constructor(
		private readonly token: string,
		private readonly baseUrl: string = DEFAULT_BASE,
	) {}

	private headers() {
		return {
			Authorization: `Bearer ${this.token}`,
			Accept: "application/json",
		};
	}

	private async fetchJson(path: string, params: URLSearchParams) {
		const res = await fetch(`${this.baseUrl}${path}?${params}`, {
			headers: this.headers(),
		});
		if (!res.ok) {
			throw new Error(
				`Tradier ${path}: ${res.status} ${res.statusText}`,
			);
		}
		return (await res.json()) as Record<string, unknown>;
	}

	async getQuote(symbol: string): Promise<Quote | null> {
		const data = await this.fetchJson(
			"/markets/quotes",
			new URLSearchParams({ symbols: symbol }),
		);
		const quotes = data.quotes as Record<string, unknown> | undefined;
		if (!quotes) return null;
		const qRaw = Array.isArray(quotes.quote) ? quotes.quote[0] : quotes.quote;
		if (!qRaw) return null;
		const q = qRaw as Record<string, unknown>;

		const kind: "stock" | "option" = isOccOptionSymbol(symbol)
			? "option"
			: "stock";
		const base: Quote = {
			symbol: (q.symbol as string) ?? symbol,
			kind,
			last: (q.last as number | null) ?? null,
			bid: (q.bid as number | null) ?? null,
			ask: (q.ask as number | null) ?? null,
			volume: (q.volume as number) ?? undefined,
			change_percentage: (q.change_percentage as number | null) ?? null,
		};
		if (kind === "option") {
			base.underlying = q.underlying as string | undefined;
			base.strike = (q.strike as number) ?? undefined;
			base.expiration = q.expiration_date as string | undefined;
			const typ = q.option_type as string | undefined;
			if (typ === "call" || typ === "put") base.option_type = typ;
		}
		return base;
	}

	async getOptionsChain(
		params: OptionsChainParams,
	): Promise<OptionsChainResult> {
		const underlyingQuote = await this.getQuote(params.symbol);
		const underlyingPrice = underlyingQuote?.last ?? 0;

		const search = new URLSearchParams({
			symbol: params.symbol,
			expiration: params.expiration,
			greeks: String(params.greeks),
		});
		const data = await this.fetchJson("/markets/options/chains", search);
		const options = data.options as Record<string, unknown> | undefined;
		const raw = (options?.option as unknown[]) || [];

		const mapped = raw.map((item): OptionData => {
			const o = item as Record<string, unknown>;
			const out: OptionData = {
				symbol: (o.symbol as string) || "",
				description: (o.description as string) || "",
				last: (o.last as number | null) ?? null,
				volume: (o.volume as number) || 0,
				bid: (o.bid as number) || 0,
				ask: (o.ask as number) || 0,
				underlying: (o.underlying as string) || "",
				strike: (o.strike as number) || 0,
				change_percentage: (o.change_percentage as number | null) ?? null,
				open_interest: (o.open_interest as number) || 0,
				expiration_date: (o.expiration_date as string) || "",
				option_type: (o.option_type as string) || "",
			};
			if (o.greeks) {
				const g = o.greeks as Record<string, unknown>;
				out.greeks = {
					delta: (g.delta as number) || 0,
					gamma: (g.gamma as number) || 0,
					theta: (g.theta as number) || 0,
					vega: (g.vega as number) || 0,
					mid_iv: (g.mid_iv as number) || 0,
				};
			}
			return out;
		});

		return { underlying_price: underlyingPrice, options: mapped };
	}

	async getHistoricalPrices(
		params: HistoricalParams,
	): Promise<HistoricalResult> {
		const search = new URLSearchParams({
			symbol: params.symbol,
			interval: params.interval,
			start: params.start,
			end: params.end,
			session_filter: params.session_filter,
		});
		const data = await this.fetchJson("/markets/history", search);
		const history = data.history as Record<string, unknown> | undefined;
		const rawDays = history?.day as unknown;
		const dayArr = Array.isArray(rawDays) ? rawDays : rawDays ? [rawDays] : [];
		const bars: Bar[] = (dayArr as Record<string, unknown>[]).map((d) => ({
			date: (d.date as string) ?? "",
			open: Number(d.open ?? 0),
			high: Number(d.high ?? 0),
			low: Number(d.low ?? 0),
			close: Number(d.close ?? 0),
			volume: Number(d.volume ?? 0),
		}));
		return { symbol: params.symbol, interval: params.interval, bars };
	}

	async getOptionExpirations(symbol: string): Promise<string[]> {
		const search = new URLSearchParams({
			symbol,
			includeAllRoots: "true",
			expirationType: "true",
		});
		const data = await this.fetchJson(
			"/markets/options/expirations",
			search,
		);
		const expirations = data.expirations as
			| Record<string, unknown>
			| undefined;
		const raw = expirations?.expiration as unknown;
		const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
		return (arr as Record<string, unknown>[])
			.map((e) => e.date as string | undefined)
			.filter((d): d is string => typeof d === "string");
	}
}

// exported for tests / debug
export type { GreeksData };
