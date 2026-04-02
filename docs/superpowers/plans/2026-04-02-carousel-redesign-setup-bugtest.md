# LCS Carousel — Redesign, Bug Audit & Mac Mini Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all 4 carousel HTML templates to a new editorial cream style, audit and fix bugs across the full pipeline, and deploy as a launchd service on the Mac Mini.

**Architecture:** Four independent template rewrites sharing a common CSS design system; targeted bug fixes to core modules; manual credential setup via web wizard; launchd service install using `process.execPath` for reliable nvm node resolution.

**Tech Stack:** Puppeteer, Telegraf 4, Gemini 2.5 Flash, LinkedIn Posts API, Meta Graph API, imgbb, SQLite (better-sqlite3), node-cron, launchd (macOS), Vitest.

---

## File Map

| File | Action |
|---|---|
| `listicle.html` | Rewrite — new design system |
| `did-you-know.html` | Rewrite — new design system |
| `seasonal.html` | Rewrite — new design system |
| `testimonial.html` | Rewrite — quote-variant of new design system |
| `scripts/install-service.js` | Fix — replace `which node` with `process.execPath` |
| `renderer.js` | Fix — correct `TEMPLATE_DIR` and `OUTPUT_DIR` paths |
| `.gitignore` | Add `.superpowers/` |
| `content-generator.js` | Audit + fix if broken |
| `render-helper.js` | Audit + fix if broken |
| `telegram-bot.js` | Audit + fix if broken |
| `bot-actions.js` | Audit + fix if broken |
| `poster.js` | Audit + fix if broken |
| `scheduler.js` | Audit + fix if broken |
| `db.js` | Audit + fix if broken |
| `utils/token-refresh.js` | Audit + fix if broken |

---

## Task 1: Redesign listicle.html

This is the reference template. The `renderSlide(slide, index, total)` function signature and `<div id="slide"></div>` mount point must be preserved exactly — `render-helper.js` depends on them.

**Files:**
- Modify: `listicle.html`

- [ ] **Step 1: Write the new file**

Replace the entire contents of `listicle.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px;
    height: 1350px;
    overflow: hidden;
    font-family: 'Source Serif 4', Georgia, serif;
    background: #f5f0e8;
    color: #1a1a2e;
  }

  /* ── SHARED: TOP BAND ── */
  .top-band {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 32px;
    background: #1a1a2e;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Source Serif 4', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #c9a84c;
    z-index: 10;
  }

  /* ── HOOK SLIDE ── */
  .slide-hook {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 100px 90px 80px;
  }

  .slide-hook .ghost-number {
    position: absolute;
    bottom: -80px;
    right: -20px;
    font-family: 'Playfair Display', serif;
    font-size: 520px;
    font-weight: 700;
    color: rgba(26, 26, 46, 0.07);
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }

  .slide-hook .category-label {
    font-family: 'Source Serif 4', serif;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #8b1a1a;
    margin-bottom: 28px;
    position: relative;
    z-index: 1;
  }

  .slide-hook h1 {
    font-family: 'Playfair Display', serif;
    font-size: 88px;
    font-weight: 700;
    line-height: 1.1;
    color: #1a1a2e;
    max-width: 860px;
    margin-bottom: 44px;
    position: relative;
    z-index: 1;
  }

  .slide-hook .divider {
    width: 80px;
    height: 4px;
    background: #c9a84c;
    position: relative;
    z-index: 1;
  }

  /* ── CONTENT SLIDE ── */
  .slide-content {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 80px 90px;
  }

  .slide-content .ghost-number {
    position: absolute;
    top: 10px;
    left: -15px;
    font-family: 'Playfair Display', serif;
    font-size: 340px;
    font-weight: 700;
    color: rgba(26, 26, 46, 0.08);
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }

  .slide-content .tip-label {
    font-family: 'Source Serif 4', serif;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 24px;
    position: relative;
    z-index: 1;
  }

  .slide-content h2 {
    font-family: 'Playfair Display', serif;
    font-size: 64px;
    font-weight: 700;
    line-height: 1.15;
    color: #1a1a2e;
    max-width: 860px;
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
  }

  .slide-content .divider {
    width: 60px;
    height: 3px;
    background: #c9a84c;
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
  }

  .slide-content p {
    font-family: 'Source Serif 4', serif;
    font-size: 34px;
    font-weight: 300;
    line-height: 1.6;
    color: #444;
    max-width: 840px;
    position: relative;
    z-index: 1;
  }

  /* ── CTA SLIDE ── */
  .slide-cta {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 80px 90px;
  }

  .slide-cta .deco-circle {
    position: absolute;
    bottom: -100px;
    right: -100px;
    width: 380px;
    height: 380px;
    border: 4px solid #c9a84c;
    border-radius: 50%;
    opacity: 0.25;
    pointer-events: none;
  }

  .slide-cta .ready-label {
    font-family: 'Source Serif 4', serif;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta h2 {
    font-family: 'Playfair Display', serif;
    font-size: 64px;
    font-weight: 700;
    line-height: 1.15;
    color: #1a1a2e;
    max-width: 820px;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta .divider {
    width: 60px;
    height: 3px;
    background: #c9a84c;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta p {
    font-family: 'Source Serif 4', serif;
    font-size: 30px;
    font-weight: 300;
    line-height: 1.6;
    color: #555;
    max-width: 700px;
    margin-bottom: 56px;
    position: relative;
    z-index: 1;
  }

  .slide-cta .cta-url {
    background: #1a1a2e;
    color: #c9a84c;
    font-family: 'Source Serif 4', serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 24px 60px;
    position: relative;
    z-index: 1;
  }
</style>
</head>
<body>
  <div id="slide"></div>

  <script>
    function renderSlide(slide, index, total) {
      const el = document.getElementById('slide');

      if (slide.type === 'hook') {
        el.className = 'slide-hook';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${total - 2}</div>
          <div class="category-label">${slide.footnote || 'Choral Music'}</div>
          <h1>${slide.headline}</h1>
          <div class="divider"></div>
        `;
      } else if (slide.type === 'cta') {
        el.className = 'slide-cta';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="deco-circle"></div>
          <div class="ready-label">Ready to Book?</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
          <div class="cta-url">londonchoralservice.com</div>
        `;
      } else {
        el.className = 'slide-content';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${index}</div>
          <div class="tip-label">Tip ${index}</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
        `;
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the renderSlide signature is intact**

```bash
grep "function renderSlide" listicle.html
```

Expected: `    function renderSlide(slide, index, total) {`

- [ ] **Step 3: Commit**

```bash
git add listicle.html
git commit -m "feat: redesign listicle template — editorial cream style"
```

---

## Task 2: Redesign did-you-know.html

Same full HTML/CSS as listicle.html. Only the `renderSlide` script block differs: hook label reads "Did You Know?", content label reads "Fact N".

**Files:**
- Modify: `did-you-know.html`

- [ ] **Step 1: Write the new file**

Copy the entire new `listicle.html` to `did-you-know.html`, then replace only the `<script>` block with:

```html
  <script>
    function renderSlide(slide, index, total) {
      const el = document.getElementById('slide');

      if (slide.type === 'hook') {
        el.className = 'slide-hook';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${total - 2}</div>
          <div class="category-label">Did You Know?</div>
          <h1>${slide.headline}</h1>
          <div class="divider"></div>
        `;
      } else if (slide.type === 'cta') {
        el.className = 'slide-cta';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="deco-circle"></div>
          <div class="ready-label">Ready to Book?</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
          <div class="cta-url">londonchoralservice.com</div>
        `;
      } else {
        el.className = 'slide-content';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${index}</div>
          <div class="tip-label">Fact ${index}</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
        `;
      }
    }
  </script>
```

- [ ] **Step 2: Commit**

```bash
git add did-you-know.html
git commit -m "feat: redesign did-you-know template — editorial cream style"
```

---

## Task 3: Redesign seasonal.html

Same full HTML/CSS as listicle.html. Hook label reads "Seasonal Guide". Content label shows position counter ("1 of 4").

**Files:**
- Modify: `seasonal.html`

- [ ] **Step 1: Write the new file**

Copy the entire new `listicle.html` to `seasonal.html`, then replace only the `<script>` block with:

```html
  <script>
    function renderSlide(slide, index, total) {
      const el = document.getElementById('slide');

      if (slide.type === 'hook') {
        el.className = 'slide-hook';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${total - 2}</div>
          <div class="category-label">Seasonal Guide</div>
          <h1>${slide.headline}</h1>
          <div class="divider"></div>
        `;
      } else if (slide.type === 'cta') {
        el.className = 'slide-cta';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="deco-circle"></div>
          <div class="ready-label">Ready to Book?</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
          <div class="cta-url">londonchoralservice.com</div>
        `;
      } else {
        el.className = 'slide-content';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${index}</div>
          <div class="tip-label">${index} of ${total - 2}</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
        `;
      }
    }
  </script>
```

- [ ] **Step 2: Commit**

```bash
git add seasonal.html
git commit -m "feat: redesign seasonal template — editorial cream style"
```

---

## Task 4: Redesign testimonial.html

Testimonial content slides are centred quote-style. The top band and CTA match the other templates. Content slides use a large ghost quotation mark instead of a ghost number, and the headline is italicised. No "Tip N" label — the quote mark is the visual anchor.

**Files:**
- Modify: `testimonial.html`

- [ ] **Step 1: Write the new file**

Replace the entire contents of `testimonial.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px;
    height: 1350px;
    overflow: hidden;
    font-family: 'Source Serif 4', Georgia, serif;
    background: #f5f0e8;
    color: #1a1a2e;
  }

  /* ── SHARED: TOP BAND ── */
  .top-band {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 32px;
    background: #1a1a2e;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Source Serif 4', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #c9a84c;
    z-index: 10;
  }

  /* ── HOOK SLIDE ── */
  .slide-hook {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 100px 90px 80px;
  }

  .slide-hook .ghost-number {
    position: absolute;
    bottom: -80px;
    right: -20px;
    font-family: 'Playfair Display', serif;
    font-size: 520px;
    font-weight: 700;
    color: rgba(26, 26, 46, 0.07);
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }

  .slide-hook .category-label {
    font-family: 'Source Serif 4', serif;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #8b1a1a;
    margin-bottom: 28px;
    position: relative;
    z-index: 1;
  }

  .slide-hook h1 {
    font-family: 'Playfair Display', serif;
    font-size: 88px;
    font-weight: 700;
    line-height: 1.1;
    color: #1a1a2e;
    max-width: 860px;
    margin-bottom: 44px;
    position: relative;
    z-index: 1;
  }

  .slide-hook .divider {
    width: 80px;
    height: 4px;
    background: #c9a84c;
    position: relative;
    z-index: 1;
  }

  /* ── CONTENT SLIDE (quote-centred) ── */
  .slide-content {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 100px 90px 80px;
  }

  .slide-content .ghost-quote {
    position: absolute;
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Playfair Display', serif;
    font-size: 300px;
    font-weight: 700;
    color: rgba(201, 168, 76, 0.1);
    line-height: 1;
    user-select: none;
    pointer-events: none;
  }

  .slide-content h2 {
    font-family: 'Playfair Display', serif;
    font-size: 56px;
    font-weight: 600;
    font-style: italic;
    line-height: 1.3;
    color: #1a1a2e;
    max-width: 820px;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-content .divider {
    width: 60px;
    height: 3px;
    background: #c9a84c;
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
  }

  .slide-content p {
    font-family: 'Source Serif 4', serif;
    font-size: 30px;
    font-weight: 300;
    line-height: 1.6;
    color: #555;
    max-width: 700px;
    position: relative;
    z-index: 1;
  }

  /* ── CTA SLIDE ── */
  .slide-cta {
    width: 1080px;
    height: 1350px;
    background: #f5f0e8;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 80px 90px;
  }

  .slide-cta .deco-circle {
    position: absolute;
    bottom: -100px;
    right: -100px;
    width: 380px;
    height: 380px;
    border: 4px solid #c9a84c;
    border-radius: 50%;
    opacity: 0.25;
    pointer-events: none;
  }

  .slide-cta .ready-label {
    font-family: 'Source Serif 4', serif;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta h2 {
    font-family: 'Playfair Display', serif;
    font-size: 64px;
    font-weight: 700;
    line-height: 1.15;
    color: #1a1a2e;
    max-width: 820px;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta .divider {
    width: 60px;
    height: 3px;
    background: #c9a84c;
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }

  .slide-cta p {
    font-family: 'Source Serif 4', serif;
    font-size: 30px;
    font-weight: 300;
    line-height: 1.6;
    color: #555;
    max-width: 700px;
    margin-bottom: 56px;
    position: relative;
    z-index: 1;
  }

  .slide-cta .cta-url {
    background: #1a1a2e;
    color: #c9a84c;
    font-family: 'Source Serif 4', serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 24px 60px;
    position: relative;
    z-index: 1;
  }
</style>
</head>
<body>
  <div id="slide"></div>

  <script>
    function renderSlide(slide, index, total) {
      const el = document.getElementById('slide');

      if (slide.type === 'hook') {
        el.className = 'slide-hook';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-number">${total - 2}</div>
          <div class="category-label">${slide.footnote || 'Choral Music'}</div>
          <h1>${slide.headline}</h1>
          <div class="divider"></div>
        `;
      } else if (slide.type === 'cta') {
        el.className = 'slide-cta';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="deco-circle"></div>
          <div class="ready-label">Ready to Book?</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
          <div class="cta-url">londonchoralservice.com</div>
        `;
      } else {
        el.className = 'slide-content';
        el.innerHTML = `
          <div class="top-band">The London Choral Service</div>
          <div class="ghost-quote">"</div>
          <h2>${slide.headline}</h2>
          <div class="divider"></div>
          <p>${slide.body}</p>
        `;
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add testimonial.html
git commit -m "feat: redesign testimonial template — editorial cream with quote-centred content"
```

---

## Task 5: Fix install-service.js — use process.execPath

`which node` resolves from the shell PATH, which may differ from the Node binary actually running the script. `process.execPath` always returns the absolute path of the currently-running Node binary — guaranteed correct for nvm installs.

**Files:**
- Modify: `scripts/install-service.js`

- [ ] **Step 1: Replace the which-node block**

Find this block (around line 30):

```javascript
let nodeBin;
try {
  nodeBin = execSync('which node', { encoding: 'utf8' }).trim();
} catch {
  console.error('\n  Could not locate the node binary. Is Node.js in your PATH?\n');
  process.exit(1);
}
```

Replace with:

```javascript
const nodeBin = process.execPath;
```

- [ ] **Step 2: Verify execSync is still imported**

`execSync` is still used for `launchctl` commands further down — keep the import. Confirm:

```bash
grep "execSync" scripts/install-service.js
```

Expected: at least 2 remaining uses (`launchctl unload` and `launchctl load`).

- [ ] **Step 3: Commit**

```bash
git add scripts/install-service.js
git commit -m "fix: use process.execPath in install-service for reliable nvm node path"
```

---

## Task 6: Fix renderer.js template paths

`renderer.js` is the standalone CLI pipeline tool (`npm run pipeline`). Its `TEMPLATE_DIR` and `OUTPUT_DIR` resolve to directories outside the project because they use `..` from the project root. Templates live at the project root — same directory as `renderer.js`.

Note: `render-helper.js` (used by the bot) already has correct paths and needs no changes.

**Files:**
- Modify: `renderer.js`

- [ ] **Step 1: Fix the path constants**

Find (near the top of `renderer.js`):

```javascript
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
```

Replace with:

```javascript
const TEMPLATE_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, 'output');
```

- [ ] **Step 2: Commit**

```bash
git add renderer.js
git commit -m "fix: correct TEMPLATE_DIR and OUTPUT_DIR paths in renderer.js"
```

---

## Task 7: Add .superpowers/ to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append the entry**

Add to the bottom of `.gitignore`:

```
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorm artifacts"
```

---

## Task 8: Audit content-generator.js

**Files:**
- Audit: `content-generator.js`

- [ ] **Step 1: Read the file**

```bash
cat content-generator.js
```

- [ ] **Step 2: Check Gemini model and thinking config**

Locate the API call. Verify:
- Model is `gemini-2.5-flash` (not an older variant)
- `thinkingConfig: { thinkingBudget: 0 }` is set in `generationConfig` — this was fixed in commit `a9d9e78`. If missing, the model enters thinking mode and `response.text()` throws because the response contains a reasoning part before the JSON part

- [ ] **Step 3: Check structured output schema**

Verify `responseMimeType: 'application/json'` and `responseSchema` are set. The schema must match:

```javascript
{
  type: 'object',
  properties: {
    topic: { type: 'string' },
    caption: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          icon: { type: 'string' },
          headline: { type: 'string' },
          body: { type: 'string' },
          footnote: { type: 'string' },
        }
      }
    }
  }
}
```

If the schema is missing, Gemini returns unstructured text and JSON.parse fails.

- [ ] **Step 4: Check topic history deduplication**

Find where `topic_history` is queried. Verify:
1. Recent topics are fetched before calling Gemini
2. The system prompt includes the used topics to avoid repetition
3. After generation, the new topic is inserted/updated in `topic_history`

- [ ] **Step 5: Run tests**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm test -- content-generator.test.js --reporter=verbose
```

Expected: all tests in `content-generator.test.js` pass.

- [ ] **Step 6: Fix any issues and commit**

```bash
git add content-generator.js
git commit -m "fix: <description>"
```

---

## Task 9: Audit render-helper.js

**Files:**
- Audit: `render-helper.js`

- [ ] **Step 1: Verify networkidle2 is used**

```bash
grep "waitUntil" render-helper.js
```

Expected: `waitUntil: 'networkidle2'` — not `networkidle0`. The comment explains why: networkidle0 hangs when Google Fonts keeps 2 keep-alive connections open.

- [ ] **Step 2: Verify font-ready timeout guard**

```bash
grep -A3 "fonts.ready" render-helper.js
```

Expected output shows:
```javascript
await Promise.race([
  page.evaluate(() => document.fonts.ready),
  new Promise((r) => setTimeout(r, 5000)),
]);
```

If only `page.evaluate(() => document.fonts.ready)` with no race, slow CDN will block indefinitely.

- [ ] **Step 3: Verify slide dimensions in config**

```bash
grep -A5 "slide" config.js
```

Expected: `width: 1080` and `height: 1350` under a `slide` key. A mismatch causes cropped screenshots.

- [ ] **Step 4: Run renderer tests**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm test -- renderer.test.js --reporter=verbose
```

- [ ] **Step 5: Fix any issues and commit**

```bash
git add render-helper.js
git commit -m "fix: <description>"
```

---

## Task 10: Audit telegram-bot.js + bot-actions.js

**Files:**
- Audit: `telegram-bot.js`, `bot-actions.js`

- [ ] **Step 1: Read both files**

```bash
cat telegram-bot.js && cat bot-actions.js
```

- [ ] **Step 2: Check callback data parsing**

In `telegram-bot.js`, find the `callback_query` handler. Verify:
1. `callbackQuery.data` is split on `:` to extract action and postId: `const [action, postId] = data.split(':')`
2. `postId` is converted to integer: `parseInt(postId, 10)`
3. Unknown actions answer the callback (to dismiss Telegram's loading spinner) rather than throwing

- [ ] **Step 3: Check conversation state cleanup**

Find the in-memory state Map (used for edit-caption flows). Verify there is a `setInterval` that removes stale entries:

```javascript
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of conversationState) {
    if (val.createdAt < cutoff) conversationState.delete(key);
  }
}, 60 * 1000);
```

If missing, stale state accumulates and edit-caption flows get stuck.

- [ ] **Step 4: Check cron schedule**

```bash
grep "cron.schedule" telegram-bot.js
```

Verify at least two schedules exist:
1. A frequent check for scheduled posts (e.g. `*/5 * * * *`)
2. A daily token refresh (e.g. `0 3 * * *`)

- [ ] **Step 5: Run bot-actions tests**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm test -- bot-actions.test.js --reporter=verbose
```

- [ ] **Step 6: Fix any issues and commit**

```bash
git add telegram-bot.js bot-actions.js
git commit -m "fix: <description>"
```

---

## Task 11: Audit poster.js

**Files:**
- Audit: `poster.js`

- [ ] **Step 1: Read the file**

```bash
cat poster.js
```

- [ ] **Step 2: Check LinkedIn 3-step document upload**

Verify in order:
1. `POST /rest/documents?action=initializeUpload` → extracts `uploadUrl` and `document` URN from response
2. `PUT {uploadUrl}` with raw PDF buffer — Content-Type must be `application/octet-stream` (not `application/pdf`, which LinkedIn rejects)
3. `POST /rest/posts` with `content: { media: { id: documentUrn } }`

- [ ] **Step 3: Check imgbb base64 upload**

Locate the imgbb upload. Verify:
1. Each slide PNG is read as a Buffer and converted to base64: `buffer.toString('base64')`
2. FormData has field name `image` with the base64 string
3. The URL extracted from the response is `data.data.url` (direct link) — not `data.data.display_url` (viewer link, doesn't work for Instagram carousel containers)

- [ ] **Step 4: Check Promise.allSettled for partial failures**

```bash
grep "allSettled\|Promise.all" poster.js
```

Publishing to all platforms must use `Promise.allSettled` — not `Promise.all`. `Promise.all` aborts on the first failure, leaving the other platforms unpublished.

- [ ] **Step 5: Run poster tests**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm test -- poster.test.js --reporter=verbose
```

- [ ] **Step 6: Fix any issues and commit**

```bash
git add poster.js
git commit -m "fix: <description>"
```

---

## Task 12: Audit scheduler.js, db.js, token-refresh.js + run full test suite

**Files:**
- Audit: `scheduler.js`, `db.js`, `utils/token-refresh.js`

- [ ] **Step 1: Read all three files**

```bash
cat scheduler.js && cat db.js && cat utils/token-refresh.js
```

- [ ] **Step 2: Check database migrations**

In `db.js`, verify:
1. `schema_version` table is created if missing
2. Migrations 001 (`last_error`, `retry_count` columns + indexes) and 002 (`topic_history` table) run in order, guarded by `schema_version`
3. WAL mode is on: `db.pragma('journal_mode = WAL')`

- [ ] **Step 3: Check scheduler day-of-week logic**

In `scheduler.js`, verify `getUTCDay()` comparisons use the correct values: `1` for Monday, `4` for Thursday (JS `getUTCDay()` is 0=Sun … 6=Sat). An off-by-one error here causes posts to be scheduled on wrong days.

- [ ] **Step 4: Check token refresh writes back to .env**

In `utils/token-refresh.js`, verify:
1. Token expiry is checked against `Date.now() + 7 * 24 * 60 * 60 * 1000` (7 days ahead)
2. New token is written to `.env` file on disk (not just `process.env`) — otherwise the refresh is lost on restart
3. Telegram notification is sent on both success and failure

- [ ] **Step 5: Run the full test suite**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm test -- --reporter=verbose
```

Expected: all 10 test files pass. Fix any remaining failures before proceeding.

- [ ] **Step 6: Commit any fixes**

```bash
git add scheduler.js db.js utils/token-refresh.js
git commit -m "fix: <description>"
```

---

## Task 13: Manual — Set up credentials via wizard

**This task requires human interaction. Pause and hand off to the user.**

- [ ] **Step 1: Start the setup wizard**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm run setup
```

Open `http://localhost:3456` in a browser.

- [ ] **Step 2: Complete all 5 OAuth steps in order**

1. **Telegram** — Bot token from @BotFather, Chat ID from @userinfobot. Click Verify.
2. **Gemini** — API key from `aistudio.google.com/apikey`. Click Verify.
3. **imgbb** — API key from `api.imgbb.com`. Click Verify.
4. **LinkedIn** — Click Connect, complete OAuth, select The London Choral Service company page.
5. **Meta** — Click Connect, complete OAuth, select Facebook page + Instagram account.

- [ ] **Step 3: Verify .env is fully populated**

```bash
grep "=$" .env
```

Expected: no output (no empty values). Then:

```bash
grep -c "=" .env
```

Expected: 14 or more.

- [ ] **Step 4: Stop the wizard**

Press `Ctrl+C` in the setup terminal.

---

## Task 14: Install Mac Mini launchd service

- [ ] **Step 1: Run the installer**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm run install-service
```

Expected final lines:
```
  ╔══════════════════════════════════════════════════╗
  ║   LCS Bot installed as a background service!     ║
  ╚══════════════════════════════════════════════════╝
```

- [ ] **Step 2: Verify service is running**

```bash
npm run service:status
```

Expected: a line containing `com.lcs.carousel-bot` with a numeric PID (not `-`).

- [ ] **Step 3: Check startup logs**

```bash
npm run service:logs
```

Expected: bot startup message within a few seconds (e.g. `🤖 LCS Carousel Bot started`).

- [ ] **Step 4: Smoke test via Telegram**

Send `/status` to the bot. Expected: response with post counts and next scheduled slot (Monday or Thursday 9am UTC).

- [ ] **Step 5: Generate and approve a test post**

Send `/generate`. Bot should:
1. Reply with a "generating" status message
2. Send a media group of 6 PNG slides
3. Show Approve / Reject / Edit Caption inline buttons

Verify the slides use the new design: 32px navy top band, warm cream background, ghost number, gold divider.

Click **Approve**, then **Publish Now** and verify the post appears on at least one platform.

- [ ] **Step 6: Test reboot persistence**

```bash
sudo reboot
```

After reboot, wait up to 2 minutes then send `/status` in Telegram. Bot must respond automatically (no manual start needed).

---

## Verification Checklist

- [ ] `grep "function renderSlide" listicle.html did-you-know.html seasonal.html testimonial.html` — 4 matches
- [ ] `npm test` — all 10 test files pass, 0 failures
- [ ] `npm run service:status` — shows running PID
- [ ] `/generate` in Telegram — 6 slides render with new design
- [ ] Post publishes to LinkedIn + Instagram + Facebook
- [ ] After reboot — `/status` responds within 2 minutes
