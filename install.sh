#!/usr/bin/env bash
set -e

# ── Colours ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   LCS Social Media — Setup                       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Check Node.js ──
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${NC}"
  echo ""
  echo "  Install it from: https://nodejs.org  (choose the LTS version)"
  echo "  Then re-run: bash install.sh"
  echo ""
  exit 1
fi

node -e "process.exit(parseInt(process.versions.node.split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null || {
  CURRENT=$(node --version)
  echo -e "${YELLOW}⚠ Node.js ${CURRENT} is too old. Version 18 or newer is required.${NC}"
  echo ""
  echo "  Update from: https://nodejs.org  (choose the LTS version)"
  echo "  Then re-run: bash install.sh"
  echo ""
  exit 1
}

echo -e "${GREEN}✓ Node.js $(node --version)${NC}"
echo ""

# ── Install dependencies ──
echo "Installing dependencies..."
npm install --silent
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# ── Run setup wizard ──
echo "Opening setup wizard in your browser..."
echo ""
npm run setup

# ── Service install prompt ──
echo ""
echo -e "${YELLOW}Install as a background service?${NC}"
echo "  This makes the bot start automatically on login and restart if it crashes."
echo ""
read -r -p "Install service? (y/N) " REPLY
echo ""
if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  npm run install-service
  echo ""
  echo -e "${GREEN}✓ Service installed. The bot will start automatically on login.${NC}"
else
  echo "  To start manually: npm start"
  echo "  To install the service later: npm run install-service"
fi

echo ""
echo -e "${GREEN}All done! Open Telegram and send /generate to your bot.${NC}"
echo ""
