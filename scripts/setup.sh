#!/usr/bin/env bash
# scripts/setup.sh
# One-command VPS setup for the LCS Social Media dashboard.
# Installs Node.js, Chromium, Caddy, configures DuckDNS, systemd, and firewall.
#
# Usage:
#   sudo bash scripts/setup.sh https://github.com/YOUR_USERNAME/lcssocialmedia.git
#
# Or from a fresh VPS:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/lcssocialmedia/main/scripts/setup.sh | sudo bash -s -- https://github.com/YOUR_USERNAME/lcssocialmedia.git

set -euo pipefail

REPO_URL="${1:-}"
APP_USER="${SUDO_USER:-ubuntu}"
APP_HOME=$(eval echo "~$APP_USER")
APP_DIR="$APP_HOME/lcssocialmedia"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   LCS Social Media — VPS Setup                   ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ══════════════════════════════════════════════════
# 1. Preflight checks
# ══════════════════════════════════════════════════

banner

if [ "$EUID" -ne 0 ]; then
  err "This script must be run as root (or with sudo)."
  echo "  Usage: sudo bash scripts/setup.sh <repo-url>"
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  err "This script requires apt-get (Ubuntu/Debian). Your OS is not supported."
  exit 1
fi

TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM_MB" -lt 512 ]; then
  warn "Only ${TOTAL_RAM_MB}MB RAM detected. Puppeteer needs at least 512MB."
  warn "A swap file will be created to compensate."
fi

info "Running as root. App user: $APP_USER ($APP_HOME)"

# ══════════════════════════════════════════════════
# 1b. Swap file (needed for e2-micro / 1GB RAM VMs)
# ══════════════════════════════════════════════════

SWAP_SIZE_MB=2048

if [ "$TOTAL_RAM_MB" -lt 2048 ]; then
  if swapon --show | grep -q "/swapfile"; then
    ok "Swap file already active."
  else
    info "Creating ${SWAP_SIZE_MB}MB swap file (Puppeteer needs extra memory)..."
    if [ ! -f /swapfile ]; then
      dd if=/dev/zero of=/swapfile bs=1M count=$SWAP_SIZE_MB status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
    fi
    swapon /swapfile
    # Persist across reboots
    if ! grep -q "/swapfile" /etc/fstab; then
      echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    ok "Swap file active (${SWAP_SIZE_MB}MB)."
  fi
fi

# ══════════════════════════════════════════════════
# 2. System dependencies
# ══════════════════════════════════════════════════

info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

info "Installing Chromium/Puppeteer dependencies..."
apt-get install -y -qq \
  git curl wget gnupg2 ca-certificates lsb-release cron \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libasound2 libxshmfence1 2>/dev/null || true

# ── Node.js 20 ──
if command -v node &>/dev/null && node -v | grep -q "^v20"; then
  ok "Node.js $(node -v) already installed."
else
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  ok "Node.js $(node -v) installed."
fi

# ── Chromium for ARM ──
CPU_ARCH=$(uname -m)
PUPPETEER_PATH=""

if [ "$CPU_ARCH" = "aarch64" ] || [ "$CPU_ARCH" = "arm64" ]; then
  info "ARM architecture detected — installing system Chromium..."
  apt-get install -y -qq chromium-browser 2>/dev/null || apt-get install -y -qq chromium 2>/dev/null || true

  # Find the installed binary
  for p in /usr/bin/chromium-browser /usr/bin/chromium /snap/bin/chromium; do
    if [ -x "$p" ]; then
      PUPPETEER_PATH="$p"
      break
    fi
  done

  if [ -n "$PUPPETEER_PATH" ]; then
    ok "System Chromium installed at $PUPPETEER_PATH"
  else
    warn "Could not find system Chromium. Puppeteer may not work on ARM."
  fi
else
  info "x86 architecture — will use Puppeteer's bundled Chrome."
fi

# ── Caddy ──
if command -v caddy &>/dev/null; then
  ok "Caddy already installed: $(caddy version 2>/dev/null || echo 'unknown')"
else
  info "Installing Caddy..."
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  ok "Caddy installed."
fi

# ══════════════════════════════════════════════════
# 3. Clone and install app
# ══════════════════════════════════════════════════

if [ -d "$APP_DIR" ]; then
  info "App directory exists at $APP_DIR — pulling latest..."
  su - "$APP_USER" -c "cd $APP_DIR && git pull" || true
else
  if [ -z "$REPO_URL" ]; then
    echo ""
    read -rp "Git repository URL: " REPO_URL
  fi
  info "Cloning repository..."
  su - "$APP_USER" -c "git clone '$REPO_URL' '$APP_DIR'"
fi

info "Installing npm dependencies..."
su - "$APP_USER" -c "cd $APP_DIR && npm install --omit=dev" 2>&1 | tail -1

# Install Puppeteer browser (x86 only — ARM uses system Chromium)
if [ -z "$PUPPETEER_PATH" ]; then
  info "Installing Puppeteer Chrome browser..."
  su - "$APP_USER" -c "cd $APP_DIR && npx puppeteer browsers install chrome" 2>&1 | tail -3
fi

ok "App installed at $APP_DIR"

# ══════════════════════════════════════════════════
# 4. Environment setup wizard
# ══════════════════════════════════════════════════

if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  info "Running environment setup wizard..."
  echo "  (This will walk you through configuring your API keys)"
  echo ""
  su - "$APP_USER" -c "cd $APP_DIR && node scripts/setup-env.js"
else
  ok ".env already exists. Skipping setup wizard."
  echo "  Run 'npm run setup' to reconfigure."
fi

# Read API_KEY from .env for later display
API_KEY=$(grep "^API_KEY=" "$APP_DIR/.env" 2>/dev/null | cut -d'=' -f2 || echo "")

# Inject PUPPETEER_EXECUTABLE_PATH if ARM and not already set
if [ -n "$PUPPETEER_PATH" ] && ! grep -q "PUPPETEER_EXECUTABLE_PATH" "$APP_DIR/.env" 2>/dev/null; then
  echo "" >> "$APP_DIR/.env"
  echo "# ── Puppeteer (ARM) ──" >> "$APP_DIR/.env"
  echo "PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_PATH" >> "$APP_DIR/.env"
  ok "Added PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_PATH to .env"
fi

# ══════════════════════════════════════════════════
# 5. DuckDNS free domain setup
# ══════════════════════════════════════════════════

echo ""
echo -e "${BOLD}── Free Domain Setup (DuckDNS) ──${NC}"
echo ""
echo "  DuckDNS gives you a free subdomain like: yourname.duckdns.org"
echo "  Sign up at https://www.duckdns.org (use GitHub or Google to log in)."
echo "  Your token is shown on the homepage after signing in."
echo ""

read -rp "Use DuckDNS for a free domain? (Y/n) " USE_DUCKDNS
USE_DUCKDNS="${USE_DUCKDNS:-y}"

DOMAIN=""

if [[ "${USE_DUCKDNS,,}" != "n" ]]; then
  read -rp "DuckDNS subdomain (the part before .duckdns.org): " DUCK_SUBDOMAIN
  read -rp "DuckDNS token: " DUCK_TOKEN

  if [ -z "$DUCK_SUBDOMAIN" ] || [ -z "$DUCK_TOKEN" ]; then
    err "Subdomain and token are required."
    exit 1
  fi

  DOMAIN="${DUCK_SUBDOMAIN}.duckdns.org"

  # Register/update the subdomain with current public IP
  info "Registering $DOMAIN with DuckDNS..."
  PUBLIC_IP=$(curl -s https://api.ipify.org)
  RESULT=$(curl -s "https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}&ip=${PUBLIC_IP}")

  if [ "$RESULT" = "OK" ]; then
    ok "$DOMAIN → $PUBLIC_IP"
  else
    err "DuckDNS update failed. Check your subdomain and token."
    err "Response: $RESULT"
    exit 1
  fi

  # Save DuckDNS config (for the cron job)
  echo "DUCK_SUBDOMAIN=$DUCK_SUBDOMAIN" > "$APP_DIR/.duckdns"
  echo "DUCK_TOKEN=$DUCK_TOKEN" >> "$APP_DIR/.duckdns"
  chmod 600 "$APP_DIR/.duckdns"

  # Install cron job for dynamic DNS updates (every 5 minutes)
  CRON_LINE="*/5 * * * * curl -s \"https://www.duckdns.org/update?domains=${DUCK_SUBDOMAIN}&token=${DUCK_TOKEN}\" > /dev/null 2>&1"
  echo "$CRON_LINE" > /etc/cron.d/duckdns
  chmod 644 /etc/cron.d/duckdns
  ok "DuckDNS cron job installed (updates IP every 5 minutes)."

else
  echo ""
  read -rp "Enter your custom domain (e.g., dash.example.com): " DOMAIN
  if [ -z "$DOMAIN" ]; then
    err "A domain is required to configure HTTPS."
    exit 1
  fi
fi

# ══════════════════════════════════════════════════
# 6. Caddy reverse proxy + basicauth
# ══════════════════════════════════════════════════

echo ""
echo -e "${BOLD}── Dashboard Security ──${NC}"
echo ""
echo "  Your dashboard will be at https://$DOMAIN"
echo "  We'll add password protection so only you can access it."
echo ""

read -rp "Dashboard username (default: admin): " CADDY_USER
CADDY_USER="${CADDY_USER:-admin}"

while true; do
  read -srp "Dashboard password: " CADDY_PASS
  echo ""
  if [ -z "$CADDY_PASS" ]; then
    echo "  Password cannot be empty."
    continue
  fi
  read -srp "Confirm password: " CADDY_PASS2
  echo ""
  if [ "$CADDY_PASS" != "$CADDY_PASS2" ]; then
    echo "  Passwords don't match. Try again."
    continue
  fi
  break
done

# Generate bcrypt hash using caddy
PASS_HASH=$(caddy hash-password --plaintext "$CADDY_PASS" 2>/dev/null)

if [ -z "$PASS_HASH" ]; then
  err "Failed to hash password with Caddy."
  exit 1
fi

# Write Caddyfile
cat > /etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
    # Password protection for the dashboard UI
    basicauth /* {
        $CADDY_USER $PASS_HASH
    }

    # Allow GitHub Actions through without password (uses API key auth)
    @autoGenerate {
        path /api/auto-generate
        header X-Api-Key *
    }
    handle @autoGenerate {
        reverse_proxy localhost:3000
    }

    # Health endpoint is public
    @health path /health
    handle @health {
        reverse_proxy localhost:3000
    }

    # Everything else requires basicauth (handled above) and proxies to the app
    reverse_proxy localhost:3000
}
CADDYEOF

ok "Caddy configured for https://$DOMAIN"

# ══════════════════════════════════════════════════
# 7. Systemd service
# ══════════════════════════════════════════════════

cat > /etc/systemd/system/lcs-dashboard.service <<SERVICEEOF
[Unit]
Description=LCS Post Approval Dashboard
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node dashboard/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
SERVICEEOF

ok "Systemd service created."

# ══════════════════════════════════════════════════
# 8. Firewall
# ══════════════════════════════════════════════════

info "Opening firewall ports 80 and 443..."

# Check if rules already exist to avoid duplicates
if ! iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
fi
if ! iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
fi

# Try to persist (may not be installed)
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save 2>/dev/null || true
fi

ok "Firewall rules applied."

# ══════════════════════════════════════════════════
# 9. Start services
# ══════════════════════════════════════════════════

info "Starting services..."
systemctl daemon-reload
systemctl enable --now lcs-dashboard
systemctl enable --now caddy

# Give Caddy a moment to provision the TLS certificate
sleep 2

# Restart Caddy to pick up new config
systemctl restart caddy

ok "Dashboard and Caddy running."

# ══════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Setup Complete!                                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Dashboard URL:${NC}  https://$DOMAIN"
echo -e "  ${GREEN}Username:${NC}       $CADDY_USER"
echo -e "  ${GREEN}Health check:${NC}   curl https://$DOMAIN/health"
echo ""
echo -e "  ${BOLD}GitHub Actions secrets to set:${NC}"
echo -e "  (Repo → Settings → Secrets and variables → Actions)"
echo ""
echo -e "    DASHBOARD_URL = ${CYAN}https://$DOMAIN${NC}"
if [ -n "$API_KEY" ]; then
  echo -e "    API_KEY       = ${CYAN}${API_KEY}${NC}"
fi
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo "    sudo journalctl -u lcs-dashboard -f    # View dashboard logs"
echo "    sudo systemctl restart lcs-dashboard    # Restart dashboard"
echo "    sudo systemctl restart caddy            # Restart Caddy"
echo "    cd $APP_DIR && git pull && npm install   # Update code"
echo ""

if [[ "${USE_DUCKDNS,,}" != "n" ]]; then
  echo -e "  ${YELLOW}IMPORTANT — Google Cloud Firewall:${NC}"
  echo "    If you did NOT check 'Allow HTTP/HTTPS traffic' when creating the VM,"
  echo "    open ports in the Cloud Console:"
  echo "    VPC network → Firewall → Create Firewall Rule"
  echo "    Allow TCP 80 and 443 from 0.0.0.0/0"
  echo ""
fi

echo -e "  ${YELLOW}Token rotation reminder:${NC}"
echo "    LinkedIn and Meta tokens expire every ~60 days."
echo "    Set a calendar reminder to refresh them."
echo ""
