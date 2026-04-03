# Simplified Setup — Design Spec

**Date:** 2026-04-03

## Context

The current setup requires three separate terminal commands (`npm install`, `npm run setup`, `npm run install-service`) and a 5-step browser wizard. For Luca, who sets this up on Mac Minis, the pain points are:

1. **Terminal friction** — three commands instead of one
2. **OAuth fatigue** — ~45 min for 5 wizard steps on first run
3. **New machine cost** — moving to a new machine means redoing all OAuth flows from scratch

The goal is to collapse first-time setup to one command and make new-machine setup take seconds via a config backup/restore.

---

## Changes

### 1. Shell installer (`install.sh`)

A single script at the repo root. Running `./install.sh` (or `bash install.sh`) does:

1. Check for Node.js ≥ 18 — if missing, print a clear install instruction and exit
2. Run `npm install`
3. Run `npm run setup` (opens wizard in browser)
4. After wizard completes, prompt once: *"Install as background service? (y/N)"* — if yes, run `npm run install-service`

**README change:** The setup section becomes a single code block: `bash install.sh`.

**Files:**
- New: `install.sh` (repo root)
- Modified: `README.md` — setup section simplified to one command

---

### 2. Config export/import (.env backup)

**Export (wizard completion screen):**
- Add a "Save config backup" button
- Clicking it triggers a file download of the current `.env` as `lcs-backup.env`
- Label: *"Save this file somewhere safe (iCloud, USB). Use it to set up a new machine instantly."*

**Import (wizard first screen):**
- Add a "Restore from backup" option alongside the normal "Start setup" button
- User selects their `lcs-backup.env` file via file picker
- Wizard reads the file, writes `.env`, validates each token via the existing platform-check endpoints
- If all tokens are valid → jump directly to completion screen
- If any tokens are expired → flag which steps need re-auth, pre-fill the rest, skip valid steps

**New machine flow:** `./install.sh` → "Restore from backup" → pick file → done.

**Files:**
- Modified: `scripts/setup-wizard/public/index.html` — add export button on completion, import option on step 0
- Modified: `scripts/setup-wizard/server.js` — add `/api/export-env` endpoint (returns .env contents) and `/api/import-env` endpoint (accepts file, validates tokens, returns status per platform)

---

### 3. Wizard step consolidation (5 steps → 3 steps)

Merge the three "paste a key" steps (Telegram, Gemini, imgbb) into a single **"API Keys"** screen. OAuth steps remain separate.

**New step structure:**
1. **API Keys** — Telegram bot token + chat ID, Gemini API key, imgbb API key (stacked fields, validate all on one screen)
2. **LinkedIn** — OAuth flow (unchanged)
3. **Facebook & Instagram** — OAuth flow (unchanged)

Progress bar: 5 dots → 3 dots. Validation on the API Keys screen runs all three checks in parallel when user clicks "Next".

**Files:**
- Modified: `scripts/setup-wizard/public/index.html` — restructure step HTML, update progress bar, combine step 1–3 fields
- Modified: `scripts/setup-wizard/server.js` — step routing/validation logic updated to reflect 3-step flow

---

## Verification

1. **Fresh install:** Clone repo, run `./install.sh` — confirm Node check works, npm install runs, wizard opens, service install prompt appears after wizard completes
2. **Backup export:** Complete wizard, click "Save config backup" — confirm `lcs-backup.env` downloads with correct contents
3. **Backup import:** On a fresh clone, run `./install.sh`, click "Restore from backup", select `lcs-backup.env` — confirm wizard skips to completion screen with all tokens validated
4. **Expired token handling:** Manually expire one token in the backup file, import — confirm wizard flags only that step and pre-fills the rest
5. **3-step wizard:** Verify progress bar shows 3 steps, all API key fields validate in parallel, OAuth steps unchanged
6. **README:** Confirm setup section shows a single command
