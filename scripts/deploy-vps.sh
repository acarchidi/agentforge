#!/usr/bin/env bash
# deploy-vps.sh — Deploy AgentForge to a VPS via SSH + Docker
#
# Prerequisites:
#   - SSH access to target VPS
#   - Docker and Docker Compose installed on VPS
#   - .env file configured locally
#
# Usage:
#   chmod +x scripts/deploy-vps.sh
#   VPS_HOST=user@your-server.com ./scripts/deploy-vps.sh
#
# Optional env vars:
#   VPS_DIR  — Remote directory (default: ~/agentforge)

set -euo pipefail

VPS_HOST="${VPS_HOST:-}"
VPS_DIR="${VPS_DIR:-~/agentforge}"

echo "=== AgentForge VPS Deployment ==="
echo ""

if [ -z "$VPS_HOST" ]; then
  echo "Error: VPS_HOST not set."
  echo "Usage: VPS_HOST=user@your-server.com ./scripts/deploy-vps.sh"
  exit 1
fi

echo "Target: $VPS_HOST:$VPS_DIR"
echo ""

# Check SSH connectivity
echo "Step 1: Checking SSH connection..."
if ! ssh -o ConnectTimeout=10 "$VPS_HOST" "echo ok" &> /dev/null; then
  echo "Error: Cannot connect to $VPS_HOST via SSH."
  exit 1
fi
echo "  SSH connection OK"
echo ""

# Check Docker is installed on VPS
echo "Step 2: Checking Docker on remote..."
if ! ssh "$VPS_HOST" "command -v docker && command -v docker compose" &> /dev/null; then
  echo "Error: Docker or Docker Compose not installed on $VPS_HOST."
  echo "Install Docker: https://docs.docker.com/engine/install/"
  exit 1
fi
echo "  Docker OK"
echo ""

# Check .env file exists locally
if [ ! -f ".env" ]; then
  echo "Warning: No .env file found locally."
  echo "Create one with the required environment variables:"
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo "  WALLET_PRIVATE_KEY=0x..."
  echo "  RECEIVE_ADDRESS=0x..."
  echo "  ADMIN_TOKEN=your-admin-token"
  echo "  FACILITATOR_URL=https://facilitator.x402.org"
  echo "  NODE_ENV=production"
  echo ""
  read -p "Continue without .env? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "Step 3: Creating remote directory..."
ssh "$VPS_HOST" "mkdir -p $VPS_DIR/data"
echo ""

echo "Step 4: Syncing project files..."
rsync -avz --exclude 'node_modules' \
            --exclude '.git' \
            --exclude 'dist' \
            --exclude '.env.local' \
            --exclude 'data/*.db' \
            ./ "$VPS_HOST:$VPS_DIR/"
echo ""

# Copy .env separately if it exists
if [ -f ".env" ]; then
  echo "Step 5: Syncing .env..."
  scp .env "$VPS_HOST:$VPS_DIR/.env"
  echo ""
fi

echo "Step 6: Building and starting on remote..."
ssh "$VPS_HOST" "cd $VPS_DIR && docker compose down 2>/dev/null || true && docker compose up -d --build"
echo ""

echo "Step 7: Waiting for startup..."
sleep 5

# Check health
echo "Step 8: Health check..."
HEALTH=$(ssh "$VPS_HOST" "curl -sf http://localhost:3402/health 2>/dev/null" || echo "")
if echo "$HEALTH" | grep -q '"ok"'; then
  echo "  Server is healthy!"
else
  echo "  Warning: Health check failed. Check logs with:"
  echo "    ssh $VPS_HOST 'cd $VPS_DIR && docker compose logs'"
fi
echo ""

echo "=== Deployment Complete ==="
echo ""
echo "Server running at: http://$VPS_HOST:3402"
echo ""
echo "Useful commands:"
echo "  View logs:    ssh $VPS_HOST 'cd $VPS_DIR && docker compose logs -f'"
echo "  Restart:      ssh $VPS_HOST 'cd $VPS_DIR && docker compose restart'"
echo "  Stop:         ssh $VPS_HOST 'cd $VPS_DIR && docker compose down'"
echo ""
echo "Next steps:"
echo "  1. Set up a reverse proxy (nginx/caddy) with SSL"
echo "  2. Run: AGENTFORGE_URL=https://your-domain.com npm run verify:first-run"
echo "  3. Fund wallet and run: npm run test:x402"
