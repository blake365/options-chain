# options-chain-mcp
Read-only MCP server for options research. Pluggable data provider — currently supports [Tradier](https://documentation.tradier.com/brokerage-api) and [Alpaca](https://docs.alpaca.markets).

## Overview

This Model Context Protocol (MCP) server gives AI assistants the tools to research options, without any ability to place trades:

- **`find-options-chain`** — chain for a symbol + expiration, filtered to options with real volume/bid/ask and strikes within a percentage of spot. Automatically trims to significant strikes to keep the payload LLM-friendly.
- **`find-option-expirations`** — valid expiration dates for an underlying.
- **`get-quote`** — latest quote for a stock symbol or a single OCC option contract. Includes Greeks + IV when the provider supports them (Alpaca does; Tradier requires a chain lookup).
- **`historical-prices`** — OHLCV bars for a stock or OCC option over any range and interval.

The server runs two ways:

- **Locally over stdio** for Claude Desktop
- **Remotely on Cloudflare Workers** with OAuth 2.1, for Claude.ai and other MCP clients that speak the remote-connector protocol

Please note:
- Requires API credentials for whichever provider you use (free paper/sandbox accounts work)
- Market data on free plans is typically 15-min delayed
- Intended for informational purposes only

Users can run queries using natural language.

## Sample Output

**Q: What are the highlights of the SPY options chain for two weeks out?**

**A:** I'll check the current SPY options chain for two weeks out from today.

View Result from find-options-chain from options-chain (local)

```json
{
  "symbol": "SPY",
  "expiration": "2025-03-28"
}
```

Now that I have the SPY options chain for March 28, 2025 (two weeks out), I'll highlight the key information:

### SPY Options Chain Highlights (March 28, 2025 Expiration)

Current Market Context

Current SPY price appears to be around $565-566 based on the at-the-money options

### Call Options Highlights

1. Highest Volume:
 - $590 calls with 217 contracts traded
 - $600 calls with 174 contracts traded
 - $571 calls with 130 contracts traded

2. Highest Open Interest:
 - $600 calls: 8,299 contracts
 - $590 calls: 6,591 contracts
 - $605 calls: 4,676 contracts
 - $580 calls: 4,596 contracts

3. Notable Activity:
 - Far out-of-the-money calls ($590-$600) showing significant volume, suggesting some traders are positioning for potential upside movement
 - The $590 calls (priced at $1.07-$1.09) have high volume and open interest


### Put Options Highlights

1. Highest Volume:
 - $500 puts with 217 contracts traded
 - $460 puts with 160 contracts traded
 - $510 puts with 163 contracts traded

2. Highest Open Interest:
 - $525 puts: 79,196 contracts (extremely high)
 - $530 puts: 7,060 contracts
 - $550 puts: 4,883 contracts
 - $570 puts: 4,337 contracts

3. Notable Activity:
 - The massive open interest in $525 puts is striking, suggesting a significant hedging position
 - Overall put activity shows traders protecting against downside risk

### Implied Volatility Indicators

 - Looking at the pricing, implied volatility appears moderate
 - The put-call ratio based on open interest is skewed toward puts, suggesting market participants are hedging against downside risk

### Options Skew

 - There's higher open interest in OTM puts than OTM calls, indicating traders are more concerned about downside protection than upside speculation

## Installation

Installing this might be tricky if you're not familiar with Node.js and the MCP protocol.

1. Install [Node.js](https://nodejs.org/en/download)
2. Clone this repository to a folder on your local machine
3. The server is already built so you can skip the build step.

### Extra Steps

If you want to make changes to the server you can do so by editing the `src/index.ts` file.
- Run `npm install` to install dependencies
- Run `npm run build` to build the server
- Quit and restart Claude Desktop after making changes


## Choosing a data provider

The server supports two providers. Set the credentials for whichever you want and (optionally) `DATA_PROVIDER` to pick explicitly. If `DATA_PROVIDER` is unset, Alpaca is used when both Alpaca keys are set, otherwise Tradier.

| Provider | Env vars | Notes |
| --- | --- | --- |
| Tradier sandbox | `TRADIER_TOKEN` | 15-min delayed. Sandbox tokens expire — [dashboard](https://sandbox.tradier.com) lets you regenerate. |
| Alpaca | `ALPACA_API_KEY_ID`, `ALPACA_SECRET_KEY` | Paper account key works fine. Free `indicative` options feed includes Greeks + IV. |

See `sample.env` for optional overrides (feed selection, base-URL overrides for live accounts).

### Provider differences worth knowing

| Field | Tradier | Alpaca |
| --- | --- | --- |
| `volume` (per option) | Daily total | `null` — not exposed by the snapshot endpoint |
| `open_interest` | Returned natively | Fetched from the trading API's contracts endpoint and merged in |
| Greeks + IV on free tier | Yes (when `greeks=true`) | Yes (free `indicative` feed) |

The chain filter treats `volume > 0 OR open_interest > 0` as "real market interest," so dead strikes get dropped on either provider. When you see `"volume": null` in an Alpaca response, that means *the provider doesn't report it* — not that the contract is inactive. Use `open_interest` for liquidity assessments on Alpaca.

## Connecting with Claude Desktop (stdio)

1. Open your Claude Desktop configuration at:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server configuration (using whichever provider you want):
```json
{
    "mcpServers": {
        "options-chain": {
            "command": "node",
            "args": [
                "/Full/Route/to/Folder/options-chain/build/index.js"
            ],
            "env": {
                "TRADIER_TOKEN": "your_tradier_sandbox_token"
            }
        }
    }
}
```

Or for Alpaca:
```json
"env": {
    "ALPACA_API_KEY_ID": "your_key_id",
    "ALPACA_SECRET_KEY": "your_secret"
}
```

3. Close/Quit then restart Claude Desktop

Once you restart you should see a small hammer icon in the lower right corner of the textbox. If you hover over the icon you'll see the number of MCP tools available.

> The legacy lowercase `token` env var is still accepted for backward compatibility with older configs.

## Running on Cloudflare Workers (remote, OAuth 2.1)

The Worker entrypoint (`src/worker.ts`) exposes the same tools over MCP's SSE and Streamable HTTP transports, wrapped in an OAuth 2.1 provider. Claude.ai (web and desktop) discovers the endpoints automatically via Dynamic Client Registration.

### Requirements

- A Cloudflare account on any paid Workers plan (Durable Objects are used for MCP session state)
- Wrangler authenticated: `npx wrangler login`
- A KV namespace bound as `OAUTH_KV` (create with `npx wrangler kv namespace create OAUTH_KV` and paste the ID into `wrangler.jsonc`)

### Configure secrets

For Tradier:
```bash
npx wrangler secret put TRADIER_TOKEN
```

For Alpaca:
```bash
npx wrangler secret put ALPACA_API_KEY_ID
npx wrangler secret put ALPACA_SECRET_KEY
# optional:
npx wrangler secret put DATA_PROVIDER            # "alpaca" or "tradier"
```

And the auth passcode that gates the consent page:
```bash
npx wrangler secret put APPROVE_PASSCODE         # e.g. `openssl rand -base64 18`
```

For local dev, put the same keys in a `.dev.vars` file at the repo root (gitignored).

### Deploy

```bash
npm run dev       # local dev server with hot reload
npm run deploy    # publish to <name>.<account>.workers.dev
```

### Connect Claude to the deployed server

In Claude.ai → Settings → Connectors → Add custom connector:

1. URL: `https://<your-worker>.workers.dev/sse` (or `/mcp` for Streamable HTTP).
2. Leave client ID/secret blank — the server advertises Dynamic Client Registration.
3. Save and click connect. Claude opens a consent page; enter the `APPROVE_PASSCODE` you set above.
4. You'll be redirected back, authorized. Tokens refresh for 30 days.

### Auth upgrade path

For multi-user access or SSO, put **Cloudflare Access** in front of the Worker route. The OAuth flow still works for the MCP client; Access just adds a second layer for the human consent page.

## Troubleshooting

If you get errors when running the server you may need to provide the full path to the `node` command. For example, on macOS: `/usr/local/bin/node`