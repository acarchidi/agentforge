# Publishing AgentForge to the MCP Server Registry

## Overview

The MCP Server Registry at `modelcontextprotocol/registry` is the official directory
for MCP servers. The old `modelcontextprotocol/servers` README no longer accepts new
server PRs — all submissions now go through the registry with `mcp-publisher`.

AgentForge is a **remote MCP server** (not an npm package). The `server.json` has
already been created at the project root.

## Prerequisites

- GitHub account (`acarchidi`)
- `mcp-publisher` CLI installed

## Step 1: Install mcp-publisher

```bash
# macOS/Linux
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

# or via Homebrew
brew install mcp-publisher
```

Verify:
```bash
mcp-publisher --help
```

## Step 2: Authenticate

```bash
mcp-publisher login github
```

Follow the device code flow — visit the URL shown, enter the code, authorize.

## Step 3: Publish

From the AgentForge project root (where `server.json` lives):

```bash
mcp-publisher publish
```

Expected output:
```
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.acarchidi/agentforge version 1.3.0
```

## Step 4: Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=agentforge"
```

## server.json Contents

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.acarchidi/agentforge",
  "title": "AgentForge — DeFi Safety Layer",
  "description": "Production-grade AI services for autonomous agents. 14 MCP tools for DeFi safety: token research, smart contract analysis, wallet safety scoring, approval scanning, gas oracle, transaction decoding, sentiment analysis, and more. Supports Ethereum, Base, Polygon, Arbitrum, Optimism, Avalanche, and Solana. Known Contract Label Registry with 186+ verified contracts. Pay-per-request via x402 protocol (USDC on Base) or use free via MCP.",
  "version": "1.3.0",
  "repository": {
    "url": "https://github.com/acarchidi/agentforge",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://agentforge-taupe.vercel.app/mcp"
    }
  ]
}
```

## Notes

- The `name` field uses GitHub namespace: `io.github.acarchidi/agentforge`
- This must match the GitHub account used for `mcp-publisher login github`
- If the GitHub repo is not yet public at `github.com/acarchidi/agentforge`,
  create it first (or use DNS authentication for a custom domain prefix)
- The remote URL points to the live Streamable HTTP MCP endpoint
- No npm package is needed — AgentForge is a remote-only MCP server
- To update: bump `version` in server.json and re-run `mcp-publisher publish`
