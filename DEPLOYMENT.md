# Deployment Guide

Run the LCS Carousel Bot as a background service on a Mac Mini (or any macOS machine).

---

## Mac Mini — Quick Start (3 commands)

```bash
npm install
npm run setup
npm run install-service
```

That's it. The bot starts immediately and auto-starts on every login.

### What each command does

**`npm install`** — installs Node.js dependencies.

**`npm run setup`** — opens the web setup wizard. Walk through the 5 steps to connect:
- Telegram bot token + your chat ID
- Gemini AI key (free, no credit card)
- imgbb image hosting key (free)
- LinkedIn (OAuth flow)
- Facebook & Instagram (OAuth flow)

Credentials are saved to `.env` in the project folder.

**`npm run install-service`** — installs the bot as a macOS launchd service. It auto-detects your project path and node binary, creates `logs/`, writes a configured plist to `~/Library/LaunchAgents/`, and loads the service immediately.

---

## Managing the Service

```bash
npm run service:status   # check if running
npm run service:logs     # tail the live log
npm run service:stop     # stop the bot
npm run service:start    # start the bot
```

---

## Token Rotation (automatic)

LinkedIn and Meta tokens expire after ~60 days. **You don't need to do anything** — the bot refreshes tokens automatically 7 days before expiry and sends a Telegram notification when it does.

If auto-refresh fails, you'll get a Telegram notification. Reconnect with:

```
/reauth linkedin
/reauth meta
/reauth all
```

This reopens the OAuth wizard without stopping the service.

---

## Updating the Bot

```bash
git pull
npm install
npm run install-service   # reloads the service with any changes
```

---

## API Keys Reference

| Key | Where to get it | Cost | Expires? |
|-----|----------------|------|----------|
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free | No |
| `LINKEDIN_ACCESS_TOKEN` | Set via `npm run setup` (OAuth) | Free | ~60 days (auto-refreshes) |
| `LINKEDIN_ORG_ID` | Your Company Page URL | Free | No |
| `FB_PAGE_ACCESS_TOKEN` | Set via `npm run setup` (OAuth) | Free | ~60 days (auto-refreshes) |
| `FB_PAGE_ID` | Facebook Page → About | Free | No |
| `IG_USER_ID` | Linked to your Facebook Page | Free | No |
| `IMGBB_API_KEY` | [api.imgbb.com](https://api.imgbb.com/) | Free | No |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram | Free | No |
| `TELEGRAM_CHAT_ID` | @userinfobot on Telegram | Free | No |

---

## What the launchd service does

| Setting | Effect |
|---|---|
| `Nice: 15` | Lowers CPU priority — other apps always get CPU first |
| `LowPriorityIO` | Deprioritizes disk I/O so renders won't slow other tasks |
| `ProcessType: Background` | macOS lowest QoS tier |
| `KeepAlive` | Auto-restarts on crash |
| `RunAtLoad` | Starts on login |
| `ThrottleInterval: 10` | Prevents crash-loop from hammering resources |

Logs: `logs/stdout.log` and `logs/stderr.log` in the project folder.

---

## Uninstalling

```bash
launchctl unload ~/Library/LaunchAgents/com.lcs.carousel-bot.plist
rm ~/Library/LaunchAgents/com.lcs.carousel-bot.plist
```

---

## VPS / Linux (pm2)

```bash
npm install
npm run setup
npx pm2 start telegram-bot.js --name lcs-bot
npx pm2 startup   # run the printed command
npx pm2 save
```

```bash
npx pm2 logs lcs-bot       # view logs
npx pm2 restart lcs-bot    # restart
npx pm2 stop lcs-bot       # stop
```

Note: pm2 is not recommended on macOS — launchd (`npm run install-service`) is native, zero-overhead, and has OS-level priority controls Docker/pm2 can't match.
