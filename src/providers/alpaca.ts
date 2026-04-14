import {
	isOccOptionSymbol,
	type Bar,
	type HistoricalParams,
	type HistoricalResult,
	type MarketDataProvider,
	type OptionData,
	type OptionsChainParams,
	type OptionsChainResult,
	type Quote,
} from "./types.js";

const DATA_BASE = "https://data.alpaca.markets";

const INTERVAL_MAP: Record<HistoricalParams["interval"], string> = {
	daily: "1Day",
	weekly: "1Week",
	monthly: "1Month",
};

interface AlpacaSnapshot {
	latestQuote?: {
		ap?: number;
		bp?: number;
		t?: string;
	};
	latestTrade?: {
		p?: number;
		s?: number;
		t?: string;
	};
	greeks?: {
		delta?: number;
		gamma?: number;
		theta?: number;
		vega?: number;
		rho?: number;
	};
	impliedVolatility?: number;
}

function parseOccSymbol(symbol: string): {
	underlying: string;
	expiration: string;
	option_type: "call" | "put";
	strike: number;
} | null {
	const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
	if (!m) return null;
	const [, underlying, yy, mm, dd, cp, strikePad] = m;
	return {
		underlying,
		expiration: `20${yy}-${mm}-${dd}`,
		option_type: cp === "C" ? "call" : "put",
		strike: Number.parseInt(strikePad, 10) / 1000,
	};
}

export interface AlpacaProviderOptions {
	keyId: string;
	secret: string;
	/** Options feed: "indicative" (free, 15-min delayed) or "opra" (paid). */
	optionsFeed?: "indicative" | "opra";
	/** Stock feed: "iex" (free, real-time IEX), "delayed_sip" (free, 15-min), "sip" (paid). */
	stockFeed?: "iex" | "delayed_sip" | "sip";
	/** Trading API host used for the contracts list (paper or live). */
	tradingBase?: string;
}

export class AlpacaProvider implements MarketDataProvider {
	readonly name = "alpaca" as const;

	private readonly optionsFeed: "indicative" | "opra";
	private readonly stockFeed: "iex" | "delayed_sip" | "sip";
	private readonly tradingBase: string;

	constructor(private readonly opts: AlpacaProviderOptions) {
		this.optionsFeed = opts.optionsFeed ?? "indicative";
		this.stockFeed = opts.stockFeed ?? "iex";
		this.tradingBase = opts.tradingBase ?? "https://paper-api.alpaca.markets";
	}

	private headers() {
		return {
			"APCA-API-KEY-ID": this.opts.keyId,
			"APCA-API-SECRET-KEY": this.opts.secret,
			Accept: "application/json",
		};
	}

	private async fetchJson(url: string): Promise<Record<string, unknown>> {
		const res = await fetch(url, { headers: this.headers() });
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(
				`Alpaca ${new URL(url).pathname}: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
			);
		}
		return (await res.json()) as Record<string, unknown>;
	}

	private snapshotToOptionData(
		symbol: string,
		snap: AlpacaSnapshot,
		openInterest = 0,
	): OptionData {
		const parsed = parseOccSymbol(symbol);
		const bid = snap.latestQuote?.bp ?? 0;
		const ask = snap.latestQuote?.ap ?? 0;
		const last = snap.latestTrade?.p ?? null;
		const data: OptionData = {
			symbol,
			description: parsed
				? `${parsed.underlying} ${parsed.expiration} ${parsed.strike} ${parsed.option_type}`
				: symbol,
			last,
			// Alpaca's snapshot doesn't carry daily volume — null signals
			// "unavailable" (vs. 0, which would imply no activity). Use
			// open_interest for the liveness signal.
			volume: null,
			bid,
			ask,
			underlying: parsed?.underlying ?? "",
			strike: parsed?.strike ?? 0,
			change_percentage: null,
			open_interest: openInterest,
			expiration_date: parsed?.expiration ?? "",
			option_type: parsed?.option_type ?? "",
		};
		if (snap.greeks || snap.impliedVolatility !== undefined) {
			data.greeks = {
				delta: snap.greeks?.delta ?? 0,
				gamma: snap.greeks?.gamma ?? 0,
				theta: snap.greeks?.theta ?? 0,
				vega: snap.greeks?.vega ?? 0,
				mid_iv: snap.impliedVolatility ?? 0,
			};
		}
		return data;
	}

	private async fetchContractOpenInterest(
		symbol: string,
		expiration: string,
	): Promise<Map<string, number>> {
		const oi = new Map<string, number>();
		let pageToken: string | null = null;
		for (let i = 0; i < 10; i++) {
			const search = new URLSearchParams({
				underlying_symbols: symbol,
				expiration_date: expiration,
				status: "active",
				limit: "10000",
			});
			if (pageToken) search.set("page_token", pageToken);
			const url = `${this.tradingBase}/v2/options/contracts?${search}`;
			const data = await this.fetchJson(url);
			const contracts =
				(data.option_contracts as Record<string, unknown>[] | undefined) ?? [];
			for (const c of contracts) {
				const sym = c.symbol as string | undefined;
				if (!sym) continue;
				const raw = c.open_interest;
				const n = typeof raw === "string" ? Number(raw) : Number(raw ?? 0);
				oi.set(sym, Number.isFinite(n) ? n : 0);
			}
			pageToken = (data.next_page_token as string | null) ?? null;
			if (!pageToken) break;
		}
		return oi;
	}

	async getQuote(symbol: string): Promise<Quote | null> {
		if (isOccOptionSymbol(symbol)) {
			const url = `${DATA_BASE}/v1beta1/options/snapshots?symbols=${encodeURIComponent(symbol)}&feed=${this.optionsFeed}`;
			const data = await this.fetchJson(url);
			const snapshots = data.snapshots as
				| Record<string, AlpacaSnapshot>
				| undefined;
			const snap = snapshots?.[symbol];
			if (!snap) return null;
			const parsed = parseOccSymbol(symbol);
			const quote: Quote = {
				symbol,
				kind: "option",
				last: snap.latestTrade?.p ?? null,
				bid: snap.latestQuote?.bp ?? null,
				ask: snap.latestQuote?.ap ?? null,
				volume: snap.latestTrade?.s ?? undefined,
				underlying: parsed?.underlying,
				strike: parsed?.strike,
				expiration: parsed?.expiration,
				option_type: parsed?.option_type,
				implied_volatility: snap.impliedVolatility ?? null,
			};
			if (snap.greeks) {
				quote.greeks = {
					delta: snap.greeks.delta ?? 0,
					gamma: snap.greeks.gamma ?? 0,
					theta: snap.greeks.theta ?? 0,
					vega: snap.greeks.vega ?? 0,
					mid_iv: snap.impliedVolatility ?? 0,
				};
			}
			return quote;
		}

		const url = `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=${this.stockFeed}`;
		const data = (await this.fetchJson(url)) as unknown as {
			latestTrade?: { p?: number };
			latestQuote?: { ap?: number; bp?: number };
			dailyBar?: { c?: number; o?: number; v?: number };
			prevDailyBar?: { c?: number };
		};
		const last = data.latestTrade?.p ?? data.dailyBar?.c ?? null;
		const prev = data.prevDailyBar?.c;
		const changePct =
			last != null && prev ? ((last - prev) / prev) * 100 : null;
		return {
			symbol,
			kind: "stock",
			last,
			bid: data.latestQuote?.bp ?? null,
			ask: data.latestQuote?.ap ?? null,
			volume: data.dailyBar?.v,
			change_percentage: changePct,
		};
	}

	async getOptionsChain(
		params: OptionsChainParams,
	): Promise<OptionsChainResult> {
		const underlying = await this.getQuote(params.symbol);
		const underlyingPrice = underlying?.last ?? 0;

		const fetchSnapshots = async () => {
			const search = new URLSearchParams({
				feed: this.optionsFeed,
				expiration_date: params.expiration,
				limit: "1000",
			});
			if (params.option_type !== "both") {
				search.set("type", params.option_type);
			}
			if (underlyingPrice > 0 && params.strike_percentage > 0) {
				const lo = underlyingPrice * (1 - params.strike_percentage / 100);
				const hi = underlyingPrice * (1 + params.strike_percentage / 100);
				search.set("strike_price_gte", lo.toFixed(2));
				search.set("strike_price_lte", hi.toFixed(2));
			}

			const collected: Array<[string, AlpacaSnapshot]> = [];
			let pageToken: string | null = null;
			for (let i = 0; i < 5; i++) {
				if (pageToken) search.set("page_token", pageToken);
				const url = `${DATA_BASE}/v1beta1/options/snapshots/${encodeURIComponent(params.symbol)}?${search}`;
				const data = await this.fetchJson(url);
				const snapshots = (data.snapshots as
					| Record<string, AlpacaSnapshot>
					| undefined) ?? {};
				for (const entry of Object.entries(snapshots)) collected.push(entry);
				pageToken = (data.next_page_token as string | null) ?? null;
				if (!pageToken) break;
			}
			return collected;
		};

		const [snapshots, openInterest] = await Promise.all([
			fetchSnapshots(),
			this.fetchContractOpenInterest(params.symbol, params.expiration),
		]);

		const options = snapshots.map(([sym, snap]) =>
			this.snapshotToOptionData(sym, snap, openInterest.get(sym) ?? 0),
		);

		return { underlying_price: underlyingPrice, options };
	}

	async getHistoricalPrices(
		params: HistoricalParams,
	): Promise<HistoricalResult> {
		const timeframe = INTERVAL_MAP[params.interval];
		const isOption = isOccOptionSymbol(params.symbol);
		const basePath = isOption
			? `${DATA_BASE}/v1beta1/options/bars`
			: `${DATA_BASE}/v2/stocks/bars`;
		const search = new URLSearchParams({
			symbols: params.symbol,
			timeframe,
			start: params.start,
			end: params.end,
			limit: "10000",
			feed: isOption ? this.optionsFeed : this.stockFeed,
		});
		const url = `${basePath}?${search}`;
		const data = await this.fetchJson(url);
		const barsByKey = (data.bars as
			| Record<string, Record<string, unknown>[]>
			| undefined) ?? {};
		const raw = barsByKey[params.symbol] ?? [];
		const bars: Bar[] = raw.map((b) => ({
			date: String(b.t ?? "").slice(0, 10),
			open: Number(b.o ?? 0),
			high: Number(b.h ?? 0),
			low: Number(b.l ?? 0),
			close: Number(b.c ?? 0),
			volume: Number(b.v ?? 0),
		}));
		return { symbol: params.symbol, interval: params.interval, bars };
	}

	async getOptionExpirations(symbol: string): Promise<string[]> {
		const today = new Date().toISOString().slice(0, 10);
		const dates = new Set<string>();
		let pageToken: string | null = null;
		let totalContracts = 0;
		let pageCount = 0;
		for (let i = 0; i < 50; i++) {
			const search = new URLSearchParams({
				underlying_symbols: symbol,
				status: "active",
				expiration_date_gte: today,
				limit: "1000",
			});
			if (pageToken) search.set("page_token", pageToken);
			const url = `${this.tradingBase}/v2/options/contracts?${search}`;
			const data = await this.fetchJson(url);
			const contracts = (data.option_contracts as
				| Record<string, unknown>[]
				| undefined) ?? [];
			totalContracts += contracts.length;
			pageCount++;
			for (const c of contracts) {
				const d = c.expiration_date as string | undefined;
				if (d) dates.add(d);
			}
			pageToken = (data.next_page_token as string | null) ?? null;
			if (!pageToken) break;
		}
		console.log(
			`[alpaca] expirations for ${symbol}: ${dates.size} unique dates across ${totalContracts} contracts (${pageCount} pages)`,
		);
		return Array.from(dates).sort();
	}
}
