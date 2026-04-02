# LCS Carousel — Redesign, Setup & Full Bug Test
**Date:** 2026-04-02
**Status:** Approved

---

## Context

The app generates social media carousels for The London Choral Service, posting to LinkedIn, Instagram, and Facebook via a Telegram bot approval interface. The Mac Mini running this has never been set up — `.env` is empty and no credentials are configured. The carousel templates need a visual overhaul (more editorial, more eye-catching) and the full pipeline needs an end-to-end bug audit before going live.

**Approach:** Design first (no credentials needed), then setup, then test and fix, then install the Mac Mini service.

---

## Section 1 — Carousel Template Redesign

### Files to modify
- `listicle.html`
- `did-you-know.html`
- `seasonal.html`
- `testimonial.html`

### Shared design system

| Element | Value |
|---|---|
| Canvas | 1080×1350px (4:5 portrait) |
| Background | `#f5f0e8` warm cream |
| Top band | 32px, `#1a1a2e` navy, brand name centred in `#c9a84c` gold, `font-size: 11px`, `letter-spacing: 2.5px`, uppercase |
| Primary text colour | `#1a1a2e` navy |
| Accent colour | `#c9a84c` gold |
| Category/label colour | `#8b1a1a` burgundy |
| Fonts | Playfair Display (headings), Source Serif 4 (body) — already loaded via Google Fonts |
| URL | Always `londonchoralservice.com` |

### Hook slide (slide 1)
- 32px navy top band with gold brand name
- Ghost slide-count number bottom-right: `font-size: ~500px`, `opacity: 0.07`, navy, clipped by container
- Burgundy all-caps category label (e.g. "Wedding Music"), `color: #8b1a1a`, `letter-spacing: 2px`
- Serif headline, 2–3 lines, `font-size: ~80px`, bold, navy
- 28px-wide gold `#c9a84c` horizontal divider rule (3px tall) below headline

### Content slides (slides 2–5)
- 32px navy top band
- Ghost slide number top-left: `font-size: ~300px`, `opacity: 0.08`, navy
- Small gold all-caps tip label (e.g. "Tip 1"), `letter-spacing: 2px`, `font-size: ~24px`
- Serif headline, ~60px, bold, navy
- 22px-wide gold divider (2px tall)
- Body text ~45 words max, `font-size: ~32px`, `color: #444`, `line-height: 1.6`

### CTA slide (slide 6)
- 32px navy top band
- Centred layout, all content vertically and horizontally centred
- Decorative partial gold circle bottom-right: `width/height: 280px`, `border: 3px solid #c9a84c`, `border-radius: 50%`, `opacity: 0.3`, clipped
- "Ready to Book?" label in `#c9a84c` gold, small caps, spaced
- Serif headline: "Let's create something beautiful together"
- 28px-wide gold divider
- Short body copy: services offered + "across London", `color: #555`
- Navy pill CTA button: `background: #1a1a2e`, `color: #c9a84c`, `font-weight: 800`, `letter-spacing: 2px`, text: `londonchoralservice.com`

### Notes
- All 4 templates share this same slide structure and design system — only the framing/tone of the content differs per template type
- The `renderSlide()` function signature in each template must remain unchanged (Puppeteer injects slide data via this function)
- Existing CSS variable names and injection points must be preserved so `renderer.js` continues to work without changes

---

## Section 2 — Setup & Credentials

### Process
1. Run `npm run setup` → opens setup wizard at `http://localhost:3456`
2. Complete all 5 steps in order:
   - **Telegram**: Enter bot token + chat ID, verify bot responds
   - **Gemini**: Enter API key, verify test generation succeeds
   - **imgbb**: Enter API key, verify test image upload succeeds
   - **LinkedIn**: Complete OAuth flow, select company page, confirm `LINKEDIN_ORG_ID` is written
   - **Meta**: Complete OAuth flow, select Facebook page + Instagram account, confirm `FB_PAGE_ID` and `IG_USER_ID` are written
3. Confirm `.env` has all required keys populated and token expiry dates are set
4. Verify `utils/token-expiry.js` correctly reads the expiry dates

### Required `.env` keys
```
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
GEMINI_API_KEY
IMGBB_API_KEY
LINKEDIN_ACCESS_TOKEN, LINKEDIN_REFRESH_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_ORG_ID, TOKEN_EXPIRY_LINKEDIN
FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID, IG_USER_ID, META_APP_ID, META_APP_SECRET, TOKEN_EXPIRY_META
```

---

## Section 3 — End-to-End Bug Audit

### Audit checklist (in order)

**Content generation**
- `/generate` triggers Gemini API call
- Response parses to valid JSON with `topic`, `caption`, `slides` (6 slides: 1 hook + 4 content + 1 CTA)
- `topic_history` table prevents duplicate topics
- Structured output schema matches what `content-generator.js` expects from Gemini 2.5 Flash

**Rendering**
- Puppeteer launches without crashing (check `--no-sandbox` flags for Mac)
- All 6 PNG slides render at 1080×1350px
- PDF is assembled correctly with `pdf-lib`
- No "Rendering..." stuck state (fixed in commit `0009dd3` — verify still works)
- Cream background renders correctly (fixed in `81a74ee` — verify)
- Files land in `data/posts/{postId}/slide-{01..06}.png` + `carousel.pdf`

**Telegram approval flow**
- Media group (6 PNGs) sends successfully
- All inline buttons render: Approve, Reject, Edit Caption, Re-render, Schedule, Publish Now
- Approve → status updates to `approved` in DB
- Edit Caption → conversation state tracks correctly, caption updates
- Schedule → picks next Mon/Thu 9am UTC slot, writes `scheduled_at` to DB
- Publish Now → triggers immediate publish

**Publishing**
- LinkedIn: PDF document upload + post creation succeeds, `urn:li:organization:` ID used correctly
- Instagram: imgbb upload succeeds (public URLs), carousel containers created, publish call succeeds
- Facebook: multi-image post succeeds
- Partial failure handling: if one platform fails, others still publish, error stored in `last_error`
- Retry logic (`utils/retry.js`): 429/502/503/504 retried, 401/403/400 not retried

**Scheduler**
- `node-cron` fires `publishScheduledPosts()` at correct intervals
- Scheduled posts with `scheduled_at <= now` are published and marked `published`
- Token refresh runs every 24h, updates `.env`, sends Telegram notification on failure

**Database**
- Both migrations run cleanly on fresh DB: `001-add-error-tracking.js`, `002-add-topic-history.js`
- `schema_version` table increments correctly
- WAL mode enabled

### Bug fix protocol
- Each bug found gets a focused fix — no scope creep
- Re-run the relevant test file after each fix: `npm test`
- All 10 test files must pass before moving to Mac Mini setup

---

## Section 4 — Mac Mini Service Installation

### Process
1. Confirm Node.js path: `which node` (nvm install at `~/.nvm/versions/node/v24.14.1/bin/node`)
2. Run `npm run install-service` → `scripts/install-service.js`
3. Script performs:
   - Verifies macOS (`process.platform === 'darwin'`)
   - Finds Node.js binary via `which node`
   - Creates `logs/` directory
   - Writes configured plist to `~/Library/LaunchAgents/com.lcs.carousel-bot.plist`
   - Runs `launchctl load`
   - Verifies service appears in `launchctl list`
4. Verify with `npm run service:status`
5. Check `npm run service:logs` — bot should log startup message
6. Send `/status` in Telegram — bot should respond with post counts and next scheduled slot
7. Reboot Mac Mini, confirm bot auto-starts and responds in Telegram

### Known issue to check
The `install-service.js` script uses `which node` to find the Node binary. Since Node is installed via nvm, the PATH at launchd load time may not include nvm. The plist `ProgramArguments` must use the **absolute path** to node (`/Users/luca/.nvm/versions/node/v24.14.1/bin/node`), not a PATH-dependent `node` command. Verify `install-service.js` resolves this correctly — fix if not.

---

## Verification

End state is considered complete when:
1. All 4 carousel templates render visually correct slides matching the design spec
2. `.env` fully populated, all OAuth flows complete
3. Full generate → render → Telegram approve → publish cycle completes without errors on all 3 platforms
4. `npm test` passes all 10 test files
5. `launchctl list | grep lcs` shows service running
6. After Mac Mini reboot, `/status` in Telegram returns a valid response
