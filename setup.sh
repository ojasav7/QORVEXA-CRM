#!/usr/bin/env bash
# ── QORVEXA CRM · one-command setup ────────────────────────────────────────
# Usage:  bash setup.sh
# Prerequisites: Node.js 20+, Docker (for MongoDB)
set -euo pipefail

echo ""
echo "  QORVEXA CRM — Setup"
echo "  ===================="
echo ""

# 1. Check Node version
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "  ✗ Node.js 20+ required (found v$(node -v))"
  echo "    Install: https://nodejs.org or use nvm: nvm use 20"
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# 2. Check Docker
if command -v docker &> /dev/null; then
  echo "  ✓ Docker found"
else
  echo "  ✗ Docker not found — needed for MongoDB"
  echo "    Install: https://docs.docker.com/get-docker/"
  exit 1
fi

# 3. Copy .env if missing
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✓ Created .env from .env.example"
else
  echo "  ✓ .env already exists"
fi

# 4. Start MongoDB
echo ""
echo "  Starting MongoDB..."
docker compose up -d mongo mongo-init
echo "  Waiting for MongoDB to be ready..."
sleep 5

# 5. Install dependencies (including landing page via postinstall)
echo ""
echo "  Installing dependencies..."
npm install

# 6. Generate Prisma client
echo ""
echo "  Generating Prisma client..."
npm run db:generate

# 7. Push schema to MongoDB
echo ""
echo "  Pushing schema to MongoDB..."
npm run db:push

# 8. Seed demo data
echo ""
echo "  Seeding demo data..."
npm run seed

# 9. Done
echo ""
echo "  ═══════════════════════════════════════════"
echo "  ✓ Setup complete!"
echo ""
echo "  Start development:"
echo "    npm run dev"
echo ""
echo "  Open in browser:"
echo "    http://localhost:8787/app"
echo ""
echo "  Login with:"
echo "    Email:    admin@qorvexa.dev"
echo "    Password: password123"
echo "  ═══════════════════════════════════════════"
echo ""
