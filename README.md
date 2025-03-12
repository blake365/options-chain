# options-chain-mcp
Claude MCP server for Tradier Sandbox API options chain endpoint and historical prices endpoint.

An MCP server implementation for providing access to the [Tradier Sandbox API](https://documentation.tradier.com/brokerage-api) within [Claude Desktop](https://claude.ai/download).

## Overview

This Model Context Protocol (MCP) server enables AI assistants and applications to:

- Get options chain data for a specific stock and expiration date
- Filter for only call or put options, or both as default
- Filter for a percentage range around the current price
- Automatically filters for significant strikes to limit context size
- Get historical prices for a specific stock or option contract in a given time range

Please note:
- Requires Tradier account and sandbox API access token
- Sandbox API market data is delayed by 15 minutes
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


## Connecting with Claude Desktop

1. Open your Claude Desktop configuration at:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server configuration:
```json 
{
    "mcpServers": {
        "options-chain": {
            "command": "node",
            "args": [
                "/Full/Route/to/Folder/options-chain/build/index.js"
            ],
            "env": {
                "token": "your_sandbox_api_token_here"
            }
        }
    }
}
```

3. Close/Quit then restart Claude Desktop

Once you restart you should see a small hammer icon in the lower right corner of the textbox. If you hover over the icon you'll see the number of MCP tools available.

## Troubleshooting

If you get errors when running the server you may need to provide the full path to the `node` command. For example, on macOS: `/usr/local/bin/node`