#!/usr/bin/env bash
# deploy-railway.sh — Deploy AgentForge to Railway
#
# Prerequisites:
#   - Railway CLI installed: npm i -g @railway/cli
#   - Logged in: railway login
#
# Usage:
#   chmod +x scripts/deploy-railway.sh
#   ./scripts/deploy-railway.sh

set -euo pipefail

echo "=== AgentForge Railway Deployment ==="
echo ""

# Check Railway CLI is installed
if ! command -v railway &> /dev/null; then
  echo "Error: Railway CLI not installed."
  echo "Install with: npm i -g @railway/cli"
  exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
  echo "Error: Not logged in to Railway."
  echo "Run: railway login"
  exit 1
fi

echo "Step 1: Initializing Railway project..."
if [ ! -f ".railway" ] && [ ! -d ".railway" ]; then
  railway init
fi

echo ""
echo "Step 2: Setting environment variables..."
echo "Please set these via the Railway dashboard or CLI:"
echo "  railway variables set ANTHROPIC_API_KEY=sk-ant-..."
echo "  railway variables set WALLET_PRIVATE_KEY=0x..."
echo "  railway variables set RECEIVE_ADDRESS=0x..."
echo "  railway variables set ADMIN_TOKEN=your-admin-token"
echo "  railway variables set FACILITATOR_URL=https://facilitator.x402.org"
echo "  railway variables set NODE_ENV=production"
echo "  railway variables set PORT=3402"
echo "  railway variables set DATABASE_PATH=/app/data/agentforge.db"
echo ""

read -p "Have you set all environment variables? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Set the variables above and re-run this script."
  exit 1
fi

echo ""
echo "Step 3: Adding persistent volume for SQLite..."
echo "Note: Add a volume in the Railway dashboard:"
echo "  Mount path: /app/data"
echo "  Size: 1 GB"
echo ""

echo "Step 4: Deploying..."
railway up

echo ""
echo "Step 5: Getting deployment URL..."
RAILWAY_URL=$(railway domain 2>/dev/null || echo "")
if [ -n "$RAILWAY_URL" ]; then
  echo "Deployed to: https://$RAILWAY_URL"
  echo ""
  echo "Run first-run verification:"
  echo "  AGENTFORGE_URL=https://$RAILWAY_URL npm run verify:first-run"
else
  echo "Deployment initiated. Check Railway dashboard for the URL."
  echo "Once deployed, run:"
  echo "  AGENTFORGE_URL=https://your-url.railway.app npm run verify:first-run"
fi

echo ""
echo "=== Done ==="
