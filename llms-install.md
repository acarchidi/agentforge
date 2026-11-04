# Installing the AgentForge MCP server

AgentForge is a remote MCP server (Streamable HTTP). There is nothing to download, build, or configure, and no API key.

1. Add this server to the MCP client's configuration:

```json
{
  "mcpServers": {
    "agentforge": {
      "type": "streamableHttp",
      "url": "https://agentforge-taupe.vercel.app/mcp"
    }
  }
}
```

   In Claude Code, the equivalent is: `claude mcp add --transport http agentforge https://agentforge-taupe.vercel.app/mcp`

2. Restart or reload the client, then list tools. You should see 28 tools, including `preflight`, `tx_simulate`, `signature_check`, `address_check`, `trade_check` and `lending_health`.

3. Verify with a call that costs nothing, e.g. `registry_lookup` with `{ "address": "0x000000000022D473030F116dDEE9F6B43aC78BA3", "chain": "base" }`; it should return "Uniswap: Permit2".

Usage notes:
- Call `preflight` before any on-chain action (send, swap, approval, signature, x402 payment); it returns one proceed / caution / avoid verdict.
- Tool calls are free up to a daily cap per client. After that, each tool's response names the paid HTTP endpoint, which is paid per call in USDC over x402 (no account needed).
