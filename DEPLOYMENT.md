# Deployment Guide: Oracle Cloud VPS + Cloudflare Access

Private dashboard accessible only by you, from anywhere, for free.

```
Browser → Cloudflare Access (auth) → Cloudflare Proxy (SSL) → Oracle VPS → Express Dashboard
```

---

## 1. Oracle Cloud Always Free VPS

### Create the VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (credit card required for verification, never charged)
2. Go to **Compute → Instances → Create Instance**
3. Choose **Always Free Eligible** shape:
   - **ARM (Ampere A1)**: Up to 4 OCPU, 24 GB RAM (recommended)
   - **AMD (E2.1.Micro)**: 1 OCPU, 1 GB RAM
4. Choose **Ubuntu 22.04** or **Oracle Linux 9** as the OS
5. Download or paste your SSH public key
6. Create the instance and note the **public IP address**

### Open firewall ports

Oracle Cloud has two firewalls: the **VCN Security List** and the **OS firewall**.

**VCN Security List** (Oracle Cloud Console):
1. Go to Networking → Virtual Cloud Networks → your VCN → Security Lists
2. Add Ingress Rules for TCP ports **80** and **443** from source `0.0.0.0/0`

**OS firewall** (on the VM):
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

### Clone and set up

```bash
git clone https://github.com/YOUR_USERNAME/lcssocialmedia.git
cd lcssocialmedia
npm install
cp .env.example .env
# Edit .env with your API keys and Cloudflare Access config
nano .env
```

### Install Caddy (reverse proxy + auto-HTTPS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:
```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl enable caddy
sudo systemctl restart caddy
```

### Create systemd service for the dashboard

Create `/etc/systemd/system/lcs-dashboard.service`:
```ini
[Unit]
Description=LCS Post Approval Dashboard
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/lcssocialmedia
ExecStart=/usr/bin/node dashboard/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/ubuntu/lcssocialmedia/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable lcs-dashboard
sudo systemctl start lcs-dashboard
```

---

## 2. Cloudflare Setup

### Add your domain

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and add your domain (free plan)
2. Update your domain's nameservers to the ones Cloudflare provides
3. Add an **A record** pointing to your Oracle VPS public IP
   - Name: `@` (or a subdomain like `dash`)
   - IPv4: your VPS IP
   - Proxy status: **Proxied** (orange cloud ON)

### Set up Cloudflare Access (Zero Trust)

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Access → Applications**
2. Click **Add an application** → **Self-hosted**
3. Configure:
   - **Application name**: LCS Dashboard
   - **Session duration**: 24 hours (or your preference)
   - **Application domain**: `yourdomain.com` (or `dash.yourdomain.com`)
4. Add an **Access Policy**:
   - **Policy name**: Only Me
   - **Action**: Allow
   - **Include rule**: Emails — `your-email@example.com`
5. Save the application
6. Copy these values from the application settings:
   - **Team domain** (shown at the top of Zero Trust dashboard, e.g. `myteam`)
   - **Application Audience (AUD)** tag (in the application's Overview tab)

### Configure the server

Edit `.env` on your VPS:
```bash
CF_ACCESS_ENABLED=true
CF_ACCESS_TEAM_DOMAIN=myteam
CF_ACCESS_AUD=abc123def456...
```

Restart the dashboard:
```bash
sudo systemctl restart lcs-dashboard
```

---

## 3. Verify

1. Visit `https://yourdomain.com` — you should see the Cloudflare Access login page
2. Enter your email, verify with the one-time code
3. You should now see the LCS dashboard
4. Try accessing from a different email or incognito — should be blocked
5. Try accessing the VPS IP directly (`http://VPS_IP:3000`) — should get 403 (JWT validation)

---

## Local Development

For local development, leave `CF_ACCESS_ENABLED` unset or `false` in your `.env`:
```bash
CF_ACCESS_ENABLED=false
npm run dashboard
# Dashboard runs on http://localhost:3000 with no auth
```

---

## Useful Commands

```bash
# View dashboard logs
sudo journalctl -u lcs-dashboard -f

# Restart dashboard
sudo systemctl restart lcs-dashboard

# Update code
cd ~/lcssocialmedia && git pull && npm install
sudo systemctl restart lcs-dashboard
```
