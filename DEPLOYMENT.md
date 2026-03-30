# Deployment Guide

Run the LCS Carousel Bot on an always-on machine (Mac Mini, VPS, etc.).

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/lcssocialmedia.git
cd lcssocialmedia
npm install
```

### 2. Configure

```bash
npm run setup
```

The wizard walks you through each API key. You'll need:
- Gemini API key (free)
- LinkedIn OAuth token + org ID
- Meta (Facebook/Instagram) token + page/account IDs
- imgbb API key (free)
- Telegram bot token (from @BotFather) + your chat ID

### 3. Test locally

```bash
npm start
```

Open Telegram and send `/generate` to your bot.

### 4. Keep it running with pm2

```bash
npx pm2 start telegram-bot.js --name lcs-bot
npx pm2 startup   # generates a startup command — run what it prints
npx pm2 save       # save current process list
```

The bot will auto-restart on crash and start on boot.

---

## API Keys Reference

| Key | Where to get it | Cost | Expires? |
|-----|----------------|------|----------|
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free | No |
| `LINKEDIN_ACCESS_TOKEN` | [linkedin.com/developers](https://www.linkedin.com/developers/) | Free | ~60 days |
| `LINKEDIN_ORG_ID` | Your Company Page URL | Free | No |
| `FB_PAGE_ACCESS_TOKEN` | [developers.facebook.com](https://developers.facebook.com/) | Free | ~60 days |
| `FB_PAGE_ID` | Facebook Page → About | Free | No |
| `IG_USER_ID` | Graph API: `GET /{page-id}?fields=instagram_business_account` | Free | No |
| `IMGBB_API_KEY` | [api.imgbb.com](https://api.imgbb.com/) | Free | No |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram | Free | No |
| `TELEGRAM_CHAT_ID` | @userinfobot on Telegram | Free | No |

---

## Token Rotation (every ~55 days)

LinkedIn and Meta tokens expire after ~60 days. Set calendar reminders.

1. Generate a new token (LinkedIn Developer Portal / Meta Graph API Explorer)
2. Edit `.env` and update the token + `TOKEN_EXPIRY_*` date
3. Restart: `npx pm2 restart lcs-bot`
4. Verify: send `/status` in Telegram

---

## Useful Commands

```bash
# View bot logs
npx pm2 logs lcs-bot

# Restart bot
npx pm2 restart lcs-bot

# Stop bot
npx pm2 stop lcs-bot

# Update code
git pull && npm install
npx pm2 restart lcs-bot

# Re-run setup wizard
npm run setup
```

---

## macOS launchd (alternative to pm2)

If you prefer native macOS process management:

Create `~/Library/LaunchAgents/com.lcs.carousel-bot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lcs.carousel-bot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/lcssocialmedia/telegram-bot.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/lcssocialmedia</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/lcs-bot.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/lcs-bot-error.log</string>
</dict>
</plist>
```

Then load it:
```bash
launchctl load ~/Library/LaunchAgents/com.lcs.carousel-bot.plist
```
