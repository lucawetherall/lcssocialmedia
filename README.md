# LCS Carousel Pipeline

Fully automated carousel/infographic post generation for **The London Choral Service** across LinkedIn, Instagram, and Facebook — managed entirely via a Telegram bot.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Telegram Bot    │────▶│  Gemini API       │────▶│  Puppeteer      │
│  (node-cron      │     │  Content Gen      │     │  Render to PNG  │
│   + approval)    │     │  (structured JSON)│     │  + PDF (LinkedIn)│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                         ┌────────────────────────────────┤
                         ▼                                ▼
              ┌──────────────────┐             ┌──────────────────┐
              │  Upload images   │             │  Post to:        │
              │  to temp host    │             │  • LinkedIn (PDF)│
              │  (imgbb)         │             │  • Instagram     │
              └──────────────────┘             │  • Facebook      │
                                               └──────────────────┘
```

## Stack (all free)

- **Content generation**: Google Gemini API via AI Studio — **completely free** (no credit card)
- **Slide rendering**: Puppeteer (headless Chromium) — free, open source
- **LinkedIn carousels**: Rendered as multi-page PDF (LinkedIn requires document upload)
- **Instagram/Facebook**: Rendered as individual PNGs, uploaded via APIs
- **Image hosting**: Images temporarily hosted on imgbb for Instagram Graph API (requires public URLs)
- **Scheduling**: Local `node-cron` — runs on your always-on machine (Mac Mini, VPS, etc.)
- **Approval interface**: Telegram bot — preview slides, approve/reject, edit captions, schedule, publish

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

This opens a guided web wizard in your browser that walks you through all 5 steps:

1. **Telegram Bot** — create via @BotFather (3 min)
2. **Gemini AI** — free API key, no credit card (2 min)
3. **Image Hosting** — free imgbb account (2 min)
4. **LinkedIn** — guided OAuth flow, auto-detects your Company Page (15 min)
5. **Facebook & Instagram** — guided OAuth flow, auto-detects Page + IG account (15 min)

Each step validates your credentials in real-time and shows green/red status. You can skip any platform you don't use.

For advanced users, a CLI fallback is available: `npm run setup:cli`

### 3. Start the bot

```bash
npm start
```

Then open Telegram and send `/generate` to your bot.

### 4. Telegram commands

| Command | Description |
|---------|-------------|
| `/generate` | Generate 1 new post and preview it |
| `/generate N` | Generate N posts (max 5) |
| `/pending` | List all draft/approved/scheduled posts |
| `/status` | Post counts, token expiry warnings |
| `/reauth <platform>` | Re-authenticate LinkedIn or Meta (opens wizard) |
| `/help` | Show available commands |

### 5. Approval workflow

When a post is generated, the bot sends you the slide images as an album, plus action buttons:

- **Approve** / **Reject** — change post status
- **Edit Caption** — send new text, choose which platform(s) to apply it to
- **Re-render** — re-render slides with current data
- **Schedule** — schedule for the next available slot (Mon/Thu 9 AM UTC)
- **Publish Now** — publish immediately to all platforms

### 6. Run the CLI pipeline (one-off)

```bash
# Generate + render + post a carousel (bypasses Telegram)
npm run pipeline

# Just generate content (no posting)
npm run dry-run

# Render only (skip posting)
npm run render-only
```

## Templates

HTML/CSS carousel templates live in the project root. Each template is a self-contained HTML file with CSS and a `renderSlide()` function.

- `listicle.html` — "5 things you should know about..." format
- `testimonial.html` — client quote/testimonial format
- `seasonal.html` — seasonal/topical guide format
- `did-you-know.html` — educational fact format

## Customisation

- Edit templates to change branding, fonts, colours
- Edit the system prompt in `content-generator.js` to change tone/topics
- Edit `config.js` to change posting schedule, platforms, dimensions

## Platform-specific notes

### LinkedIn
- Organic carousels are PDF documents, not image carousels
- The pipeline renders slides to a single multi-page PDF
- Uses the LinkedIn Community Management API (Posts API + Document upload)

### Instagram
- Uses the Instagram Graph API via a connected Facebook Page
- Images must be publicly accessible URLs (hosted on imgbb)
- Carousel = multiple image containers + single publish call

### Facebook
- Uses the Facebook Graph API (Pages API)
- Multi-image posts via the same Page Access Token as Instagram
