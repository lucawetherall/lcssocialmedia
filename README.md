# LCS Carousel Pipeline

Fully automated carousel/infographic post generation for **The London Choral Service** across LinkedIn, Instagram, Facebook, and TikTok.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Cron Trigger    │────▶│  Claude API       │────▶│  Puppeteer      │
│  (GitHub Action  │     │  Content Gen      │     │  Render to PNG  │
│   or local cron) │     │  (structured JSON)│     │  + PDF (LinkedIn)│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                         ┌────────────────────────────────┤
                         ▼                                ▼
              ┌──────────────────┐             ┌──────────────────┐
              │  Upload images   │             │  Post to:        │
              │  to temp host    │             │  • LinkedIn (PDF)│
              │  (imgbb/0x0.st) │             │  • Instagram     │
              └──────────────────┘             │  • Facebook      │
                                               │  • TikTok        │
                                               └──────────────────┘
```

## Stack (all free)

- **Content generation**: Google Gemini API via AI Studio — **completely free** (no credit card)
- **Slide rendering**: Puppeteer (headless Chromium) — free, open source
- **LinkedIn carousels**: Rendered as multi-page PDF (LinkedIn requires document upload)
- **Instagram/Facebook/TikTok**: Rendered as individual PNGs, uploaded via APIs
- **Image hosting**: Images temporarily hosted for Instagram Graph API (requires public URLs)
- **Scheduling**: GitHub Actions cron (free tier: 2,000 mins/month on private repos)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

Required keys:
- `GEMINI_API_KEY` — free from https://aistudio.google.com/apikey (no credit card needed)
- `LINKEDIN_ACCESS_TOKEN` — from LinkedIn Developer Portal
- `LINKEDIN_ORG_ID` — your LinkedIn Company Page URN
- `FB_PAGE_ACCESS_TOKEN` — from Meta Developer Portal (manages both FB + IG)
- `FB_PAGE_ID` — your Facebook Page ID
- `IG_USER_ID` — your Instagram Professional Account ID
- `TIKTOK_ACCESS_TOKEN` — from TikTok Developer Portal
- `IMGBB_API_KEY` — free image hosting for Instagram (get at api.imgbb.com)

### 3. Run locally

```bash
# Generate + render + post a carousel
node scripts/pipeline.js

# Just generate content (no posting)
node scripts/pipeline.js --dry-run

# Generate content for a specific topic
node scripts/pipeline.js --topic "Choosing hymns for a funeral service"

# Render only (skip posting)
node scripts/pipeline.js --render-only
```

### 4. Deploy to GitHub Actions

The included `.github/workflows/carousel.yml` runs the pipeline on a cron schedule.
Push to GitHub and configure your secrets in Settings → Secrets and variables → Actions.

## Templates

HTML/CSS carousel templates live in `/templates/`. Each template is a self-contained HTML file
with CSS embedded and placeholder variables (e.g. `{{headline}}`, `{{body}}`).

Currently included:
- `listicle.html` — "5 things you should know about..." format
- `testimonial.html` — client quote/testimonial format
- `seasonal.html` — seasonal/topical guide format
- `did-you-know.html` — educational fact format

## Customisation

- Edit templates in `/templates/` to change branding, fonts, colours
- Edit the system prompt in `scripts/content-generator.js` to change tone/topics
- Edit `scripts/config.js` to change posting schedule, platforms, dimensions

## Platform-specific notes

### LinkedIn
- Organic carousels are PDF documents, not image carousels
- The pipeline renders slides to a single multi-page PDF
- Uses the LinkedIn Community Management API (Posts API + Document upload)
- Requires a LinkedIn Page with admin access + a Developer App

### Instagram
- Uses the Instagram Graph API via a connected Facebook Page
- Images must be publicly accessible URLs (hosted on imgbb)
- Carousel = multiple image containers → single publish call
- Requires an Instagram Professional (Business/Creator) account

### Facebook
- Uses the Facebook Graph API (Pages API)
- Multi-image posts via the same Page Access Token as Instagram

### TikTok
- Uses the TikTok Content Posting API
- Photo posts (carousel-style) — requires developer approval
- Most restricted platform; may need manual posting as fallback
