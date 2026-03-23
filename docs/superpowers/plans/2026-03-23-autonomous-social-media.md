# Autonomous Social Media Posting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LCS social media system fully autonomous — auto-generate carousel posts via AI, auto-schedule to Mon/Thu 9am, auto-publish to LinkedIn/Instagram/Facebook, with a dashboard for manual override.

**Architecture:** Fix-First approach. Harden the existing pipeline with retry logic, error recovery, and database migrations. Then add autonomous generation/scheduling endpoints, comprehensive tests, and deploy to Oracle Cloud VPS. The dashboard server is the single runtime — GitHub Actions triggers it via API.

**Tech Stack:** Node.js 20+ (ESM), Express 5, SQLite (better-sqlite3), Puppeteer, Vitest, Google Gemini API, LinkedIn/Meta Graph APIs, GitHub Actions

**Spec:** `/Users/lucawetherall/.claude/plans/quirky-nibbling-badger.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `utils/retry.js` | Shared retry with exponential backoff |
| `utils/retry.test.js` | Tests for retry utility |
| `utils/token-expiry.js` | Token expiry checking utility |
| `utils/token-expiry.test.js` | Tests for token expiry |
| `dashboard/scheduler.js` | Scheduling logic (slot calculation, assignment) |
| `dashboard/scheduler.test.js` | Tests for scheduler |
| `dashboard/migrations/001-add-error-tracking.js` | First DB migration |
| `.github/workflows/carousel.yml` | GitHub Actions workflow (moved from root) |
| `vitest.config.js` | Test framework config |
| `poster.test.js` | Tests for platform posting |
| `content-generator.test.js` | Tests for AI content generation |
| `renderer.test.js` | Tests for slide rendering |
| `config.test.js` | Tests for config validation |
| `dashboard/server.test.js` | Integration tests for API endpoints |
| `dashboard/db.test.js` | Tests for database layer |
| `dashboard/auth.test.js` | Tests for Cloudflare Access auth |
| `pipeline.test.js` | End-to-end pipeline test |

### Modified Files
| File | Changes |
|------|---------|
| `poster.js` | Deep refactor: throw on failure, `publishToAllPlatforms` wrapper, retry, timeouts, remove TikTok |
| `config.js` | Remove TikTok config |
| `pipeline.js` | Update for new poster API, remove TikTok |
| `content-generator.js` | No changes (topic selection moves to server) |
| `dashboard/server.js` | Auto-generate endpoint, error recovery, publishing lock, health check, refactored auth |
| `dashboard/db.js` | Migration system, new columns, indexes, topic_history table |
| `dashboard/auth.js` | Export API key middleware, keep CF Access middleware |
| `dashboard/public/js/app.js` | Failed status, pause toggle, retry button, remove TikTok |
| `dashboard/public/index.html` | Add pause toggle UI, failed filter button |
| `.env.example` | Credential docs, token expiry vars, remove TikTok |
| `package.json` | Add vitest, test scripts |

### Deleted Files
| File | Reason |
|------|--------|
| `carousel.yml` (root) | Moved to `.github/workflows/carousel.yml` |

---

## Phase 1: Reliability

### Task 1: Create retry utility

**Files:**
- Create: `utils/retry.js`
- Create: `utils/retry.test.js`
- Modify: `package.json` (add vitest)
- Create: `vitest.config.js`

- [ ] **Step 1: Install vitest and create config**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    restoreMocks: true,
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Write failing test for retry utility**

Create `utils/retry.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry } from './retry.js';

describe('fetchWithRetry', () => {
  it('returns response on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
    });
    const res = await fetchWithRetry('https://example.com', {}, { fetch: mockFetch });
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Map() })
      .mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithRetry('https://example.com', {}, {
      fetch: mockFetch, maxRetries: 3, baseDelay: 10,
    });
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 502/503/504', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Map() })
      .mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithRetry('https://example.com', {}, {
      fetch: mockFetch, maxRetries: 3, baseDelay: 10,
    });
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400/401/403', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Map() });
    const res = await fetchWithRetry('https://example.com', {}, {
      fetch: mockFetch, maxRetries: 3, baseDelay: 10,
    });
    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Map() });
    await expect(
      fetchWithRetry('https://example.com', {}, { fetch: mockFetch, maxRetries: 2, baseDelay: 10 })
    ).rejects.toThrow('after 2 retries');
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('retries on network errors', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithRetry('https://example.com', {}, {
      fetch: mockFetch, maxRetries: 3, baseDelay: 10,
    });
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After header', async () => {
    const headers = new Map([['retry-after', '1']]);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValue({ ok: true, status: 200 });
    const start = Date.now();
    await fetchWithRetry('https://example.com', {}, {
      fetch: mockFetch, maxRetries: 3, baseDelay: 10,
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(900); // ~1s from Retry-After
  });

  it('adds timeout via AbortSignal', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('aborted')), 200))
    );
    await expect(
      fetchWithRetry('https://example.com', {}, {
        fetch: mockFetch, maxRetries: 0, timeout: 100,
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run utils/retry.test.js`
Expected: FAIL — module not found

- [ ] **Step 6: Implement `utils/retry.js`**

```js
// utils/retry.js
// Shared retry utility with exponential backoff for API calls

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

/**
 * Fetch with automatic retry and exponential backoff.
 * @param {string} url
 * @param {RequestInit} options
 * @param {object} retryOptions
 * @param {number} retryOptions.maxRetries - Max retry attempts (default: 3)
 * @param {number} retryOptions.baseDelay - Base delay in ms (default: 1000)
 * @param {number} retryOptions.timeout - Request timeout in ms (default: 30000)
 * @param {Function} retryOptions.fetch - Fetch implementation (for testing)
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    timeout = 30000,
    fetch: fetchFn = globalThis.fetch,
  } = retryOptions;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout via AbortSignal
      const controller = new AbortController();
      const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;

      const res = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      // Success
      if (res.ok) return res;

      // Non-retryable client errors — return immediately
      if (NON_RETRYABLE_STATUS_CODES.has(res.status)) return res;

      // Retryable server errors
      if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < maxRetries) {
        const retryAfter = res.headers?.get?.('retry-after');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelay * Math.pow(2, attempt);
        console.warn(`⚠ ${url}: ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      // Exhausted retries on server error
      if (attempt === maxRetries && RETRYABLE_STATUS_CODES.has(res.status)) {
        throw new Error(`${url} failed with ${res.status} after ${maxRetries} retries`);
      }

      return res;
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        throw new Error(`${url} timed out after ${timeout}ms`);
      }
      // Network errors are retryable
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠ ${url}: ${err.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw new Error(`${url} failed after ${maxRetries} retries: ${err.message}`);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run utils/retry.test.js`
Expected: All 8 tests PASS

- [ ] **Step 8: Commit**

```bash
git add utils/retry.js utils/retry.test.js vitest.config.js package.json package-lock.json
git commit -m "feat: add retry utility with exponential backoff and tests"
```

---

### Task 2: Remove TikTok from all files

**Files:**
- Modify: `poster.js` (lines 290-342: delete `postToTikTok`)
- Modify: `config.js` (lines 73, 92-95: remove TikTok API version and platform config)
- Modify: `pipeline.js` (line 8: remove TikTok import, line 89: remove TikTok call)
- Modify: `dashboard/server.js` (line 13: remove TikTok import, line 80, 211, 358-365, 449: remove TikTok references)
- Modify: `dashboard/db.js` (line 30: remove `caption_tiktok`, line 34: remove from default platforms)
- Modify: `dashboard/public/js/app.js` (line 182, 451: remove TikTok caption fields)
- Modify: `.env.example` (lines 14-15: remove TikTok)
- Modify: `carousel.yml` (line 44: remove TikTok secret)

- [ ] **Step 1: Remove TikTok from `poster.js`**

Delete `postToTikTok` function (lines 290-342) and remove it from exports. Keep the three remaining exports: `postToLinkedIn`, `postToInstagram`, `postToFacebook`.

- [ ] **Step 2: Remove TikTok from `config.js`**

Remove `tikTokApiVersion: 'v2'` from `api` section (line 73).
Remove `tiktok: { enabled: true, format: 'png' }` from `platforms` section (lines 92-95).

- [ ] **Step 3: Remove TikTok from `pipeline.js`**

Line 8: change import to `import { postToLinkedIn, postToInstagram, postToFacebook } from './poster.js';`
Delete line 89 (`await postToTikTok(imagePaths, caption);`).

- [ ] **Step 4: Remove TikTok from `dashboard/server.js`**

Line 13: change import to `import { postToLinkedIn, postToInstagram, postToFacebook } from '../poster.js';`
Line 80: remove `caption_tiktok` from update handler.
Line 211: change default platforms to `'["linkedin","instagram","facebook"]'`.
Delete lines 358-365 (TikTok publish block).
Delete line 449 (TikTok in scheduled publisher).

- [ ] **Step 5: Remove TikTok from `dashboard/db.js`**

Line 30: remove `caption_tiktok TEXT,`
Line 34: change default platforms to `'["linkedin","instagram","facebook"]'`

- [ ] **Step 6: Remove TikTok from `dashboard/public/js/app.js`**

Line 182: remove `$('#edit-caption-tiktok').value = currentPost.caption_tiktok || '';`
Line 451: remove `caption_tiktok: $('#edit-caption-tiktok').value || null,`

- [ ] **Step 7: Remove TikTok from `.env.example`**

Delete lines 14-15 (`# TikTok...` and `TIKTOK_ACCESS_TOKEN=`).

- [ ] **Step 8: Remove TikTok from `carousel.yml`**

Delete line 44 (`TIKTOK_ACCESS_TOKEN: ${{ secrets.TIKTOK_ACCESS_TOKEN }}`).

- [ ] **Step 9: Remove TikTok from `dashboard/public/index.html`**

Find and remove:
1. The TikTok caption textarea/label in the post edit modal
2. The TikTok checkbox in the platform toggles section (`<input type="checkbox" value="tiktok" checked> TikTok`)

- [ ] **Step 10: Verify nothing references TikTok**

Run: `grep -ri tiktok --include='*.js' --include='*.html' --include='*.yml' --include='*.json' .`
Expected: No matches (except possibly package-lock.json or node_modules)

- [ ] **Step 11: Commit**

```bash
git add poster.js config.js pipeline.js dashboard/server.js dashboard/db.js dashboard/public/js/app.js dashboard/public/index.html .env.example carousel.yml
git commit -m "refactor: remove TikTok integration from all files"
```

---

### Task 3: Deep refactor poster.js

**Files:**
- Modify: `poster.js`
- Create: `poster.test.js`

- [ ] **Step 1: Write failing tests for new poster API**

Create `poster.test.js`.

**Note on ESM module caching:** Since this project uses `"type": "module"`, dynamic `import()` calls are cached. Use `vi.mock()` with factory functions at the top level to mock dependencies. The poster functions read `globalThis.fetch` and `process.env` at call time (not import time), so mocking these in `beforeEach` works correctly.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postToLinkedIn, postToInstagram, postToFacebook, publishToAllPlatforms } from './poster.js';

// Mock fetch at module level — poster.js reads globalThis.fetch at call time
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')) },
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
}));

describe('poster', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.IMGBB_API_KEY = 'test-imgbb-key';
    process.env.LINKEDIN_ACCESS_TOKEN = 'test-li-token';
    process.env.LINKEDIN_ORG_ID = 'urn:li:organization:123';
    process.env.FB_PAGE_ACCESS_TOKEN = 'test-fb-token';
    process.env.FB_PAGE_ID = 'test-page-id';
    process.env.IG_USER_ID = 'test-ig-user';
  });

  describe('postToLinkedIn', () => {
    it('throws on API failure instead of swallowing', async () => {
      // postToLinkedIn already imported at top level
      mockFetch.mockResolvedValue({
        ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }),
        text: () => Promise.resolve('fail'), headers: new Map(),
      });
      await expect(postToLinkedIn('/fake/path.pdf', 'test caption'))
        .rejects.toThrow();
    });

    it('returns structured result on success', async () => {
      // postToLinkedIn already imported at top level
      // Mock register, upload, and post calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true, status: 200, headers: new Map(),
          json: () => Promise.resolve({ value: { uploadUrl: 'https://upload.url', document: 'urn:doc:123' } }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: new Map() })
        .mockResolvedValueOnce({ ok: true, status: 201, headers: new Map(), json: () => Promise.resolve({}) });

      const result = await postToLinkedIn('/fake/path.pdf', 'caption');
      expect(result).toEqual(expect.objectContaining({
        platform: 'linkedin',
        success: true,
      }));
    });
  });

  describe('publishToAllPlatforms', () => {
    it('collects results from all platforms', async () => {
      // publishToAllPlatforms already imported at top level
      // All platforms succeed (mock the full flow)
      mockFetch.mockResolvedValue({
        ok: true, status: 200, headers: new Map(),
        json: () => Promise.resolve({ value: { uploadUrl: 'https://u.url', document: 'urn:d:1' }, id: '123', success: true, data: { url: 'https://img.url' } }),
        text: () => Promise.resolve('ok'),
      });

      const result = await publishToAllPlatforms(
        { pdfPath: '/fake.pdf', imagePaths: ['/fake.png'], captions: { linkedin: 'cap', instagram: 'cap', facebook: 'cap' } },
        ['linkedin']
      );
      expect(result.results).toHaveLength(1);
      expect(result.results[0].platform).toBe('linkedin');
    });

    it('captures individual platform failures without stopping others', async () => {
      // publishToAllPlatforms already imported at top level
      // LinkedIn fails, others succeed
      mockFetch
        .mockRejectedValueOnce(new Error('LinkedIn is down'))
        .mockResolvedValue({
          ok: true, status: 200, headers: new Map(),
          json: () => Promise.resolve({ id: '123', success: true, data: { url: 'https://img.url' } }),
        });

      const result = await publishToAllPlatforms(
        { pdfPath: '/fake.pdf', imagePaths: ['/fake.png'], captions: { linkedin: 'cap', facebook: 'cap' } },
        ['linkedin', 'facebook']
      );
      expect(result.allSucceeded).toBe(false);
      expect(result.failedPlatforms).toContain('linkedin');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run poster.test.js`
Expected: FAIL — functions don't throw, `publishToAllPlatforms` doesn't exist

- [ ] **Step 3: Refactor `poster.js` — make functions throw on failure**

For each of `postToLinkedIn`, `postToInstagram`, `postToFacebook`:
1. Remove the outer `try/catch` that swallows errors
2. Remove the early `return console.log()` for disabled/missing creds — throw instead
3. Use `fetchWithRetry` from `utils/retry.js` instead of bare `fetch`
4. Each function MUST return a structured result on success:
   - `postToLinkedIn`: `return { platform: 'linkedin', success: true }`
   - `postToInstagram`: `return { platform: 'instagram', success: true, postId: publishData.id }`
   - `postToFacebook`: `return { platform: 'facebook', success: true, postId: postData.id }`
5. Let errors propagate (callers handle them via `publishToAllPlatforms`)

- [ ] **Step 4: Add `publishToAllPlatforms` wrapper**

Add to `poster.js`:
```js
/**
 * Publish to all requested platforms, collecting results.
 * @param {object} post - { pdfPath, imagePaths, captions: { linkedin, instagram, facebook } }
 * @param {string[]} platforms - ['linkedin', 'instagram', 'facebook']
 * @returns {{ results: Array, allSucceeded: boolean, failedPlatforms: string[] }}
 */
export async function publishToAllPlatforms(post, platforms) {
  const results = [];
  const failedPlatforms = [];

  for (const platform of platforms) {
    try {
      let result;
      const caption = post.captions[platform] || post.captions.default || '';
      switch (platform) {
        case 'linkedin':
          result = await postToLinkedIn(post.pdfPath, caption);
          break;
        case 'instagram':
          result = await postToInstagram(post.imagePaths, caption);
          break;
        case 'facebook':
          result = await postToFacebook(post.imagePaths, caption);
          break;
        default:
          result = { platform, success: false, error: `Unknown platform: ${platform}` };
      }
      results.push(result);
    } catch (err) {
      results.push({ platform, success: false, error: err.message });
      failedPlatforms.push(platform);
    }
  }

  return {
    results,
    allSucceeded: failedPlatforms.length === 0,
    failedPlatforms,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run poster.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add poster.js poster.test.js
git commit -m "refactor: poster.js throws on failure, adds publishToAllPlatforms wrapper with retry"
```

---

### Task 4: Update callers of poster functions

**Files:**
- Modify: `dashboard/server.js` (publish endpoint lines 310-372, scheduled publisher lines 428-461)
- Modify: `pipeline.js` (lines 74-93)

- [ ] **Step 1: Update `dashboard/server.js` publish endpoint**

Replace the manual per-platform try/catch blocks (lines 322-368) with:
```js
import { publishToAllPlatforms } from '../poster.js';
// ...
const publishResult = await publishToAllPlatforms({
  pdfPath,
  imagePaths,
  captions: {
    linkedin: captionFor('linkedin'),
    instagram: captionFor('instagram'),
    facebook: captionFor('facebook'),
    default: post.caption,
  },
}, platforms);

queries.updatePostStatus.run('published', post.id);
res.json({ status: 'published', results: publishResult.results });
```

- [ ] **Step 2: Update `dashboard/server.js` scheduled publisher**

Replace the fire-and-forget IIFE (lines 436-456) with proper error handling using `publishToAllPlatforms`. (Detailed in Task 6 which adds the full publishing lock.)

- [ ] **Step 3: Update `pipeline.js`**

Replace lines 74-93 (individual platform calls) with:
```js
import { publishToAllPlatforms } from './poster.js';
// ...
const result = await publishToAllPlatforms({
  pdfPath,
  imagePaths,
  captions: { default: caption },
}, ['linkedin', 'instagram', 'facebook']);

console.log('└──────────────────────────────────────────────');
console.log('');
if (result.allSucceeded) {
  console.log('✓ Pipeline complete — all platforms published');
} else {
  console.log(`⚠ Pipeline complete — failed: ${result.failedPlatforms.join(', ')}`);
  process.exit(1);
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/server.js pipeline.js
git commit -m "refactor: update all poster callers to use publishToAllPlatforms"
```

---

### Task 5: Database migration system + new columns

**Files:**
- Modify: `dashboard/db.js`
- Create: `dashboard/migrations/001-add-error-tracking.js`
- Create: `dashboard/db.test.js`

- [ ] **Step 1: Write failing test for migration system**

Create `dashboard/db.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

describe('database migrations', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    db.close();
  });

  it('creates posts table with new columns on fresh install', () => {
    // Import will be tested after implementation
    const cols = db.prepare("PRAGMA table_info(posts)").all();
    // This test will be fleshed out after the schema is applied
    expect(cols).toBeDefined();
  });

  it('schema_version table exists after migration', () => {
    // Will test that runMigrations creates schema_version
  });

  it('adds last_error and retry_count columns', () => {
    // Will test migration 001
  });

  it('creates indexes on status, scheduled_at, created_at', () => {
    // Will test migration 001
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/db.test.js`
Expected: FAIL

- [ ] **Step 3: Add migration system to `dashboard/db.js`**

After the existing `CREATE TABLE IF NOT EXISTS` block, add:
```js
// ── Migration system ──

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL DEFAULT 0
  );
`);

const versionRow = db.prepare('SELECT version FROM schema_version').get();
if (!versionRow) {
  db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
}

function getCurrentVersion() {
  return db.prepare('SELECT version FROM schema_version').get()?.version || 0;
}

function setVersion(v) {
  db.prepare('UPDATE schema_version SET version = ?').run(v);
}
```

- [ ] **Step 4: Create `dashboard/migrations/001-add-error-tracking.js`**

```js
// dashboard/migrations/001-add-error-tracking.js
export default function migrate(db) {
  // Add error tracking columns
  const cols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);

  if (!cols.includes('last_error')) {
    db.exec('ALTER TABLE posts ADD COLUMN last_error TEXT');
  }
  if (!cols.includes('retry_count')) {
    db.exec('ALTER TABLE posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  }

  // Add indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
  `);
}
```

- [ ] **Step 5: Wire up migration runner in `dashboard/db.js`**

```js
import migrate001 from './migrations/001-add-error-tracking.js';

const migrations = [migrate001];

const currentVersion = getCurrentVersion();
for (let i = currentVersion; i < migrations.length; i++) {
  console.log(`Running migration ${i + 1}...`);
  migrations[i](db);
  setVersion(i + 1);
}
```

- [ ] **Step 6: Update `queries` in `dashboard/db.js`**

Add to the `queries` object:
```js
updatePostError: db.prepare(
  'UPDATE posts SET last_error = ?, retry_count = retry_count + 1, updated_at = datetime(\'now\') WHERE id = ?'
),
clearPostError: db.prepare(
  'UPDATE posts SET last_error = NULL, retry_count = 0, updated_at = datetime(\'now\') WHERE id = ?'
),
getFailedPosts: db.prepare(
  'SELECT * FROM posts WHERE status = \'failed\' ORDER BY updated_at DESC'
),
```

Update `getAllPosts` ordering to include `failed`:
```sql
CASE status WHEN 'draft' THEN 1 WHEN 'approved' THEN 2 WHEN 'scheduled' THEN 3 WHEN 'publishing' THEN 3 WHEN 'failed' THEN 4 WHEN 'published' THEN 5 WHEN 'rejected' THEN 6 END
```

- [ ] **Step 7: Flesh out and run tests**

Run: `npx vitest run dashboard/db.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add dashboard/db.js dashboard/db.test.js dashboard/migrations/001-add-error-tracking.js
git commit -m "feat: add database migration system with error tracking columns and indexes"
```

---

### Task 6: Scheduled publisher with error recovery + publishing lock

**Files:**
- Modify: `dashboard/server.js` (lines 428-461)

- [ ] **Step 1: Replace the scheduled publisher in `server.js`**

Replace lines 428-461 with:
```js
// ── Scheduled post publisher (runs every 60 seconds) ──

let isPublishing = false;

async function publishScheduledPosts() {
  if (isPublishing) return; // Guard: skip if previous cycle still running
  isPublishing = true;
  try {
    const duePosts = queries.getDuePosts.all();

    // Process sequentially to avoid rate-limit spikes
    for (const row of duePosts) {
      const post = parsePost(row);

      // Set 'publishing' lock to prevent re-pickup
      queries.updatePostStatus.run('publishing', post.id);
      console.log(`⏰ Publishing scheduled post: "${post.topic}"`);

      try {
        const postDir = path.join(DATA_DIR, 'posts', String(post.id));
        const imagePaths = post.slides.map(
          (_, i) => path.join(postDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
        );
        const pdfPath = path.join(postDir, 'carousel.pdf');

        const captionFor = (platform) => post[`caption_${platform}`] || post.caption;

        const result = await publishToAllPlatforms({
          pdfPath,
          imagePaths,
          captions: {
            linkedin: captionFor('linkedin'),
            instagram: captionFor('instagram'),
            facebook: captionFor('facebook'),
            default: post.caption,
          },
        }, post.platforms);

        if (result.allSucceeded) {
          queries.updatePostStatus.run('published', post.id);
          queries.clearPostError.run(post.id);
          console.log(`✓ Scheduled post published: "${post.topic}"`);
        } else {
          throw new Error(`Failed platforms: ${result.failedPlatforms.join(', ')}`);
        }
      } catch (err) {
        const retryCount = (post.retry_count || 0) + 1;
        const maxRetries = 3;

        if (retryCount >= maxRetries) {
          queries.updatePostStatus.run('failed', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.error(`✗ Post permanently failed after ${maxRetries} retries: "${post.topic}" — ${err.message}`);
        } else {
          // Back to scheduled for retry on next tick
          queries.updatePostStatus.run('scheduled', post.id);
          queries.updatePostError.run(err.message, post.id);
          console.warn(`⚠ Post failed (attempt ${retryCount}/${maxRetries}), will retry: "${post.topic}" — ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err.message);
  } finally {
    isPublishing = false;
  }
}

setInterval(publishScheduledPosts, 60_000);
```

- [ ] **Step 2: Update `getDuePosts` query to exclude `publishing` status**

In `dashboard/db.js`, the `getDuePosts` query already only selects `status = 'scheduled'`, so `publishing` posts are automatically excluded. No change needed.

- [ ] **Step 3: Commit**

```bash
git add dashboard/server.js
git commit -m "feat: scheduled publisher with publishing lock, error recovery, and auto-retry"
```

---

### Task 7: Token expiry checking

**Files:**
- Create: `utils/token-expiry.js`
- Create: `utils/token-expiry.test.js`
- Modify: `.env.example`

- [ ] **Step 1: Write failing test**

Create `utils/token-expiry.test.js`:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkTokenExpiry } from './token-expiry.js';

describe('checkTokenExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23'));
  });

  it('returns no warnings when no expiry dates set', () => {
    const warnings = checkTokenExpiry({});
    expect(warnings).toEqual([]);
  });

  it('returns warning when token expires within 7 days', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: '2026-03-28',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LinkedIn');
    expect(warnings[0]).toContain('5 days');
  });

  it('returns expired message when token is past expiry', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_META: '2026-03-20',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('EXPIRED');
  });

  it('returns no warnings when token has >7 days remaining', () => {
    const warnings = checkTokenExpiry({
      TOKEN_EXPIRY_LINKEDIN: '2026-05-01',
    });
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run utils/token-expiry.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `utils/token-expiry.js`**

```js
// utils/token-expiry.js
// Check OAuth token expiry dates and return warnings

const TOKEN_MAP = {
  TOKEN_EXPIRY_LINKEDIN: 'LinkedIn',
  TOKEN_EXPIRY_META: 'Meta (Facebook + Instagram)',
};

const WARNING_DAYS = 7;

export function checkTokenExpiry(env = process.env) {
  const warnings = [];
  const now = new Date();

  for (const [envVar, platformName] of Object.entries(TOKEN_MAP)) {
    const expiryStr = env[envVar];
    if (!expiryStr) continue;

    const expiry = new Date(expiryStr);
    if (isNaN(expiry.getTime())) continue;

    const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0) {
      warnings.push(`${platformName} token EXPIRED ${Math.abs(daysRemaining)} days ago — regenerate immediately`);
    } else if (daysRemaining <= WARNING_DAYS) {
      warnings.push(`${platformName} token expires in ${daysRemaining} days — regenerate soon`);
    }
  }

  return warnings;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run utils/token-expiry.test.js`
Expected: PASS

- [ ] **Step 5: Add token expiry vars to `.env.example`**

Add after the Meta section:
```
# ── Token Expiry Dates (set when generating tokens) ──
# ISO date format: YYYY-MM-DD
# Warnings appear in /health and logs when within 7 days of expiry
# TOKEN_EXPIRY_LINKEDIN=2026-05-20
# TOKEN_EXPIRY_META=2026-05-20
```

- [ ] **Step 6: Commit**

```bash
git add utils/token-expiry.js utils/token-expiry.test.js .env.example
git commit -m "feat: token expiry checking with proactive warnings"
```

---

## Phase 2: Autonomous Pipeline

### Task 8: Extract scheduler module

**Files:**
- Create: `dashboard/scheduler.js`
- Create: `dashboard/scheduler.test.js`

- [ ] **Step 1: Write failing tests for scheduler**

Create `dashboard/scheduler.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextAvailableSlots } from './scheduler.js';

describe('getNextAvailableSlots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:00:00Z')); // Monday
  });

  it('returns next N Mon/Thu slots', () => {
    const slots = getNextAvailableSlots(4, {
      recurringDays: ['monday', 'thursday'],
      recurringTime: '09:00',
      existingScheduledDates: [],
    });
    expect(slots).toHaveLength(4);
    // Next slots: Thu Mar 26, Mon Mar 30, Thu Apr 2, Mon Apr 6
    expect(slots[0]).toContain('2026-03-26');
    expect(slots[1]).toContain('2026-03-30');
  });

  it('skips slots that already have scheduled posts', () => {
    const slots = getNextAvailableSlots(2, {
      recurringDays: ['monday', 'thursday'],
      recurringTime: '09:00',
      existingScheduledDates: ['2026-03-26 09:00:00'],
    });
    // Thu Mar 26 is taken, so: Mon Mar 30, Thu Apr 2
    expect(slots[0]).toContain('2026-03-30');
  });

  it('handles custom days and times', () => {
    const slots = getNextAvailableSlots(1, {
      recurringDays: ['wednesday'],
      recurringTime: '14:00',
      existingScheduledDates: [],
    });
    expect(slots[0]).toContain('2026-03-25');
    expect(slots[0]).toContain('14:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/scheduler.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `dashboard/scheduler.js`**

```js
// dashboard/scheduler.js
// Scheduling logic for auto-posting

const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Find the next N available posting slots.
 * @param {number} count
 * @param {object} options
 * @param {string[]} options.recurringDays - e.g. ['monday', 'thursday']
 * @param {string} options.recurringTime - e.g. '09:00'
 * @param {string[]} options.existingScheduledDates - ISO dates already scheduled
 * @returns {string[]} Array of ISO datetime strings
 */
export function getNextAvailableSlots(count, { recurringDays, recurringTime, existingScheduledDates }) {
  const targetDayNumbers = recurringDays.map(d => DAY_MAP[d.toLowerCase()]).filter(n => n !== undefined);
  const [hours, minutes] = recurringTime.split(':').map(Number);
  const existingSet = new Set(existingScheduledDates.map(d => d.slice(0, 16))); // compare up to minutes

  const slots = [];
  const cursor = new Date();
  cursor.setUTCHours(hours, minutes, 0, 0);

  // Start from tomorrow to avoid scheduling in the past
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  // Search up to 90 days ahead
  const maxDate = new Date(cursor);
  maxDate.setUTCDate(maxDate.getUTCDate() + 90);

  while (slots.length < count && cursor < maxDate) {
    if (targetDayNumbers.includes(cursor.getUTCDay())) {
      const isoStr = cursor.toISOString().replace('T', ' ').slice(0, 19);
      const compareStr = isoStr.slice(0, 16);
      if (!existingSet.has(compareStr)) {
        slots.push(isoStr);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run dashboard/scheduler.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/scheduler.js dashboard/scheduler.test.js
git commit -m "feat: scheduler module with slot calculation"
```

---

### Task 9: Topic freshness tracking

**Files:**
- Modify: `dashboard/db.js`
- Create: `dashboard/migrations/002-add-topic-history.js`

- [ ] **Step 1: Create migration 002**

```js
// dashboard/migrations/002-add-topic-history.js
export default function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      used_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_topic_history_topic ON topic_history(topic);
    CREATE INDEX IF NOT EXISTS idx_topic_history_used_at ON topic_history(used_at);
  `);
}
```

- [ ] **Step 2: Wire up migration 002 in `db.js`**

Add `import migrate002 from './migrations/002-add-topic-history.js';` and add to the migrations array.

- [ ] **Step 3: Add topic_history queries to `db.js`**

```js
recordTopicUsage: db.prepare(
  'INSERT INTO topic_history (topic) VALUES (?)'
),
getRecentTopics: db.prepare(
  "SELECT DISTINCT topic FROM topic_history WHERE used_at > datetime('now', '-30 days')"
),
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/db.js dashboard/migrations/002-add-topic-history.js
git commit -m "feat: topic freshness tracking with 30-day cooldown"
```

---

### Task 10: Refactor auth — route-specific CF Access + API key

**Files:**
- Modify: `dashboard/auth.js`
- Modify: `dashboard/server.js`
- Create: `dashboard/auth.test.js`

- [ ] **Step 1: Write failing test for API key auth**

Create `dashboard/auth.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { apiKeyAuth } from './auth.js';

describe('apiKeyAuth', () => {
  it('returns 401 when no API key header', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is wrong', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: { 'x-api-key': 'wrong-key' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next() when API key matches', () => {
    process.env.API_KEY = 'test-secret';
    const req = { headers: { 'x-api-key': 'test-secret' } };
    const res = {};
    const next = vi.fn();
    apiKeyAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add `apiKeyAuth` middleware to `dashboard/auth.js`**

```js
export function apiKeyAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API_KEY not configured on server' });
  }
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}
```

- [ ] **Step 3: Refactor `server.js` auth — make CF Access route-specific**

Replace line 23 (`app.use(cfAccessAuth);`) with:

```js
// Auth: CF Access for browser routes, API key for automation routes
// /health and static files have no auth (CF Access protects at network level)
function protectedRoute(handler) {
  return [cfAccessAuth, handler];
}
```

Then apply `cfAccessAuth` only to API routes that need it (all `/api/*` except `/api/auto-generate` and `/health`). The simplest approach: use Express router groups.

- [ ] **Step 4: Run tests**

Run: `npx vitest run dashboard/auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/auth.js dashboard/auth.test.js dashboard/server.js
git commit -m "refactor: route-specific auth — CF Access for dashboard, API key for automation"
```

---

### Task 11: Auto-generate endpoint

**Files:**
- Modify: `dashboard/server.js`

- [ ] **Step 1: Add `POST /api/auto-generate` endpoint**

```js
import { apiKeyAuth } from './auth.js';
import { getNextAvailableSlots } from './scheduler.js';

app.post('/api/auto-generate', apiKeyAuth, async (req, res) => {
  try {
    const batchSize = Math.min(parseInt(req.body?.count) || parseInt(queries.getSetting.get('batch_size')?.value) || 5, 20);

    // Get available topics (exclude recently used)
    const recentTopics = queries.getRecentTopics.all().map(r => r.topic);
    const availableTopics = CONFIG.topics.filter(t => !recentTopics.includes(t));
    const topicPool = availableTopics.length > 0 ? availableTopics : CONFIG.topics; // recycle if exhausted

    // Get next available schedule slots
    const scheduledDates = queries.getPostsByStatus.all('scheduled').map(p => p.scheduled_at).filter(Boolean);
    const settings = {};
    queries.getAllSettings.all().forEach(r => {
      try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
    });
    const slots = getNextAvailableSlots(batchSize, {
      recurringDays: settings.recurring_days || ['monday', 'thursday'],
      recurringTime: settings.recurring_time || '09:00',
      existingScheduledDates: scheduledDates,
    });

    const results = [];

    for (let i = 0; i < batchSize; i++) {
      const topic = topicPool[Math.floor(Math.random() * topicPool.length)];
      const template = CONFIG.templates[Math.floor(Math.random() * CONFIG.templates.length)];

      try {
        const content = await generateCarouselContent(topic, template);

        const result = queries.createPost.run({
          topic: content.topic,
          template,
          caption: content.caption,
          slides: JSON.stringify(content.slides),
          status: 'approved',
          platforms: JSON.stringify(['linkedin', 'instagram', 'facebook']),
        });

        const postId = result.lastInsertRowid;
        await renderPostSlides(postId, content.slides, template);

        // Mark as rendered
        const post = queries.getPost.get(postId);
        if (post) {
          const parsed = parsePost(post);
          queries.updatePost.run({
            ...parsed,
            slides: JSON.stringify(parsed.slides),
            platforms: JSON.stringify(parsed.platforms),
            rendered: 1,
          });
        }

        // Schedule
        if (slots[i]) {
          queries.updatePostSchedule.run(slots[i], postId);
        }

        // Record topic usage
        queries.recordTopicUsage.run(content.topic);

        results.push({
          id: postId,
          topic: content.topic,
          template,
          status: slots[i] ? 'scheduled' : 'approved',
          scheduled_at: slots[i] || null,
        });

        console.log(`✓ Auto-generated post ${i + 1}/${batchSize}: "${content.topic}" → ${slots[i] || 'unscheduled'}`);
      } catch (err) {
        console.error(`✗ Failed to generate post ${i + 1}:`, err.message);
        results.push({ error: err.message });
      }
    }

    res.json({ generated: results.length, scheduled: slots.slice(0, results.length), results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add `/health` endpoint (no auth)**

```js
import { checkTokenExpiry } from '../utils/token-expiry.js';

app.get('/health', (req, res) => {
  const lastPublished = db.prepare(
    "SELECT updated_at FROM posts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 1"
  ).get();
  const pendingPosts = db.prepare(
    "SELECT COUNT(*) as count FROM posts WHERE status IN ('approved', 'scheduled')"
  ).get();
  const nextScheduled = db.prepare(
    "SELECT scheduled_at FROM posts WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 1"
  ).get();
  const failedPosts = db.prepare(
    "SELECT COUNT(*) as count FROM posts WHERE status = 'failed'"
  ).get();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    lastPublished: lastPublished?.updated_at || null,
    pendingPosts: pendingPosts?.count || 0,
    nextScheduled: nextScheduled?.scheduled_at || null,
    failedPosts: failedPosts?.count || 0,
    tokenWarnings: checkTokenExpiry(),
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/server.js
git commit -m "feat: auto-generate endpoint with topic freshness and auto-scheduling, plus /health endpoint"
```

---

### Task 12: Dashboard UI updates

**Files:**
- Modify: `dashboard/public/js/app.js`
- Modify: `dashboard/public/index.html`

- [ ] **Step 1: Add "Failed" to status filter buttons in `index.html`**

Find the filter buttons section and add:
```html
<button class="filter-btn" data-status="failed">Failed</button>
```

- [ ] **Step 2: Add "Pause All" toggle to sidebar in `index.html`**

```html
<div class="pause-toggle">
  <label>
    <input type="checkbox" id="pause-all"> Pause auto-publishing
  </label>
</div>
```

- [ ] **Step 3: Update `renderStats()` in `app.js` to include `failed` and `publishing`**

Line 139 — add `failed: 0, publishing: 0` to the counts object.

- [ ] **Step 4: Add pause toggle logic in `app.js`**

```js
// In init():
const pauseCheckbox = $('#pause-all');
const pauseSetting = await api('/api/settings');
if (pauseCheckbox) pauseCheckbox.checked = pauseSetting.paused === true;

// Bind pause toggle
$('#pause-all')?.addEventListener('change', async (e) => {
  await api('/api/settings', {
    method: 'PUT',
    body: { paused: e.target.checked },
  });
  toast(e.target.checked ? 'Auto-publishing paused' : 'Auto-publishing resumed');
});
```

- [ ] **Step 5: Add retry button for failed posts in `app.js`**

In the modal, show a "Retry" button when status is `failed`:
```js
// In renderModal():
const retryBtn = $('#btn-retry');
if (retryBtn) {
  retryBtn.style.display = currentPost.status === 'failed' ? '' : 'none';
}

// Bind:
$('#btn-retry')?.addEventListener('click', async () => {
  if (!currentPost) return;
  try {
    // Reset to scheduled for retry
    currentPost = await api(`/api/posts/${currentPost.id}`, {
      method: 'PUT',
      body: { status: 'scheduled', scheduled_at: new Date().toISOString().replace('T', ' ').slice(0, 19) },
    });
    renderModal();
    toast('Post queued for retry');
  } catch (err) {
    toast(err.message, 'error');
  }
});
```

- [ ] **Step 6: Add retry button to `index.html` modal**

```html
<button id="btn-retry" class="btn btn-warning" style="display:none">Retry</button>
```

- [ ] **Step 7: Show error message in modal for failed posts**

```js
// In renderModal():
const errorDisplay = $('#post-error');
if (errorDisplay) {
  errorDisplay.textContent = currentPost.last_error || '';
  errorDisplay.style.display = currentPost.status === 'failed' ? '' : 'none';
}
```

- [ ] **Step 8: Check pause setting in scheduled publisher**

In `dashboard/server.js`, at the start of `publishScheduledPosts()`:
```js
const pausedSetting = queries.getSetting.get('paused');
if (pausedSetting?.value === 'true') return;
```

- [ ] **Step 9: Commit**

```bash
git add dashboard/public/js/app.js dashboard/public/index.html dashboard/server.js
git commit -m "feat: dashboard UI — failed status, pause toggle, retry button, error display"
```

---

### Task 13: Move GitHub Actions workflow

**Files:**
- Delete: `carousel.yml` (root)
- Create: `.github/workflows/carousel.yml`

- [ ] **Step 1: Create `.github/workflows/` directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write new workflow**

Create `.github/workflows/carousel.yml`:
```yaml
# .github/workflows/carousel.yml
# Triggers the LCS dashboard to auto-generate and schedule posts

name: LCS Auto-Generate Posts

on:
  schedule:
    - cron: '0 9 * * 1'   # Monday 9am UTC
    - cron: '0 9 * * 4'   # Thursday 9am UTC
  workflow_dispatch:

jobs:
  trigger-generation:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Run tests
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Trigger auto-generate on dashboard
        run: |
          response=$(curl -sf -w "\n%{http_code}" \
            -X POST "${{ secrets.DASHBOARD_URL }}/api/auto-generate" \
            -H "Content-Type: application/json" \
            -H "X-Api-Key: ${{ secrets.API_KEY }}" \
            -d '{"count": 5}')
          http_code=$(echo "$response" | tail -1)
          body=$(echo "$response" | head -n -1)
          echo "Response: $body"
          echo "HTTP Code: $http_code"
          if [ "$http_code" -ge 400 ]; then
            echo "::error::Dashboard API returned $http_code"
            exit 1
          fi
```

- [ ] **Step 3: Delete old `carousel.yml` from root**

```bash
git rm carousel.yml
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/carousel.yml
git commit -m "feat: move workflow to .github/workflows/, update to trigger dashboard API"
```

---

### Task 14: Update pipeline.js for new poster API

**Files:**
- Modify: `pipeline.js`

- [ ] **Step 1: Update imports and posting section**

Already handled in Task 4. Verify the changes are in place:
- Import is `publishToAllPlatforms` instead of individual functions
- Posting section uses the wrapper and reports results

- [ ] **Step 2: Commit if any additional changes needed**

---

## Phase 3: Testing

### Task 15: Content generator tests

**Files:**
- Create: `content-generator.test.js`

- [ ] **Step 1: Write tests**

**Note on ESM module caching:** `generateCarouselContent` reads `process.env.GEMINI_API_KEY` and `globalThis.fetch` at call time, not import time, so mocking in `beforeEach` works even though the module is only imported once.

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCarouselContent } from './content-generator.js';

describe('generateCarouselContent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns structured content with 6 slides', async () => {
    const mockContent = {
      topic: 'Test topic',
      caption: 'Test caption #test',
      slides: Array.from({ length: 6 }, (_, i) => ({
        type: i === 0 ? 'hook' : i === 5 ? 'cta' : 'content',
        icon: '🎵',
        headline: `Slide ${i + 1}`,
        body: i === 0 ? '' : 'Test body text',
      })),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(mockContent) }] } }],
      }),
    });

    const result = await generateCarouselContent('Test topic', 'listicle');
    expect(result.slides).toHaveLength(6);
    expect(result.topic).toBe('Test topic');
  });

  it('throws on missing API key', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateCarouselContent('topic')).rejects.toThrow('GEMINI_API_KEY');
  });

  it('throws on malformed JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'not json at all' }] } }],
      }),
    });
    await expect(generateCarouselContent('topic')).rejects.toThrow();
  });

  it('throws on wrong slide count', async () => {
    const badContent = { topic: 'x', caption: 'x', slides: [{ type: 'hook', headline: 'x', body: '' }] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: JSON.stringify(badContent) }] } }],
      }),
    });
    await expect(generateCarouselContent('topic')).rejects.toThrow('Expected 6 slides');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run content-generator.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add content-generator.test.js
git commit -m "test: content generator tests — parsing, validation, error handling"
```

---

### Task 16: Config tests

**Files:**
- Create: `config.test.js`

- [ ] **Step 1: Write tests**

```js
import { describe, it, expect } from 'vitest';
import { CONFIG } from './config.js';

describe('CONFIG', () => {
  it('has valid slide dimensions', () => {
    expect(CONFIG.slide.width).toBe(1080);
    expect(CONFIG.slide.height).toBe(1350);
    expect(CONFIG.slide.width / CONFIG.slide.height).toBeCloseTo(0.8); // 4:5
  });

  it('has 6 slides per carousel', () => {
    expect(CONFIG.slideCount).toBe(6);
  });

  it('has at least 20 topics', () => {
    expect(CONFIG.topics.length).toBeGreaterThanOrEqual(20);
  });

  it('has 4 templates', () => {
    expect(CONFIG.templates).toEqual(['listicle', 'seasonal', 'did-you-know', 'testimonial']);
  });

  it('has no TikTok in platforms', () => {
    expect(CONFIG.platforms.tiktok).toBeUndefined();
  });

  it('has LinkedIn, Instagram, Facebook platforms', () => {
    expect(CONFIG.platforms.linkedin).toBeDefined();
    expect(CONFIG.platforms.instagram).toBeDefined();
    expect(CONFIG.platforms.facebook).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests and commit**

```bash
npx vitest run config.test.js
git add config.test.js
git commit -m "test: config validation tests"
```

---

### Task 16b: Renderer tests

**Files:**
- Create: `renderer.test.js`

- [ ] **Step 1: Write renderer tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { CONFIG } from './config.js';

// Mock puppeteer to avoid launching real browser in tests
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewport: vi.fn(),
        setContent: vi.fn(),
        evaluate: vi.fn(),
        screenshot: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    writeFile: vi.fn(),
  },
}));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: vi.fn().mockResolvedValue({
      embedPng: vi.fn().mockResolvedValue({}),
      addPage: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      setTitle: vi.fn(),
      setAuthor: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array()),
    }),
  },
}));

describe('renderCarousel', () => {
  it('renders correct number of slides', async () => {
    const { renderCarousel } = await import('./renderer.js');
    const content = {
      topic: 'Test',
      slides: Array.from({ length: 6 }, (_, i) => ({
        type: i === 0 ? 'hook' : 'content',
        headline: `Slide ${i}`,
        body: 'test',
      })),
    };
    const result = await renderCarousel(content, 'listicle');
    expect(result.imagePaths).toHaveLength(6);
    expect(result.pdfPath).toContain('carousel.pdf');
  });

  it('uses correct viewport dimensions', async () => {
    expect(CONFIG.slide.width).toBe(1080);
    expect(CONFIG.slide.height).toBe(1350);
  });
});
```

- [ ] **Step 2: Run tests and commit**

```bash
npx vitest run renderer.test.js
git add renderer.test.js
git commit -m "test: renderer tests with mocked Puppeteer and pdf-lib"
```

---

### Task 17: Server integration tests

**Files:**
- Create: `dashboard/server.test.js`

- [ ] **Step 1: Write integration tests for key endpoints**

Test: GET /api/posts, POST /api/posts/:id/approve, POST /api/posts/:id/schedule, GET /api/settings, PUT /api/settings, GET /health, POST /api/auto-generate (with API key).

Use `supertest` or direct fetch against the Express app. Since the server uses SQLite, tests can use an in-memory database.

Note: This test file will be complex. Focus on the critical paths:
- Status transitions (draft → approved → scheduled → published)
- Auto-generate endpoint returns correct structure
- Health endpoint returns expected fields
- API key auth blocks unauthorized requests

- [ ] **Step 2: Run tests**

Run: `npx vitest run dashboard/server.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add dashboard/server.test.js
git commit -m "test: server integration tests — endpoints, status transitions, auth"
```

---

### Task 18: End-to-end pipeline test

**Files:**
- Create: `pipeline.test.js`

- [ ] **Step 1: Write e2e test with all external APIs mocked**

Test the full flow: generate → render → publish, with:
- Gemini API mocked (returns valid content)
- Puppeteer rendering mocked or using a minimal template
- All platform APIs mocked (LinkedIn, Instagram, Facebook)
- imgbb mocked

Verify: content passes through each stage, structured results returned, failures handled.

- [ ] **Step 2: Run test and commit**

```bash
npx vitest run pipeline.test.js
git add pipeline.test.js
git commit -m "test: end-to-end pipeline test with all external APIs mocked"
```

---

### Task 19: Add test step to CI

Already handled in Task 13 — the new workflow includes `npm test` before triggering generation.

- [ ] **Step 1: Verify `npm test` is in the workflow**

Check `.github/workflows/carousel.yml` includes the test step.

- [ ] **Step 2: Run all tests locally**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit if any fixes needed**

---

## Phase 4: Deployment & Docs

### Task 20: Update .env.example with credential guide

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Rewrite `.env.example` with detailed setup instructions**

```
# ═══════════════════════════════════════════════
# LCS Social Media Automation — Environment Config
# ═══════════════════════════════════════════════
# Copy this file to .env and fill in your values.

# ── Content Generation (FREE) ──
# Get a free API key at: https://aistudio.google.com/apikey
# No credit card required. 15 RPM / 1M TPM free tier.
GEMINI_API_KEY=

# ── LinkedIn ──
# 1. Create app at https://www.linkedin.com/developers/
# 2. Request "Community Management API" access
# 3. Generate OAuth token with scopes: w_member_social, w_organization_social
# 4. Get org ID from your Company Page URL (the number after /company/)
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_ORG_ID=urn:li:organization:XXXXXXXX

# ── Meta (Facebook + Instagram) ──
# 1. Create app at https://developers.facebook.com/
# 2. Add "Instagram Graph API" product
# 3. Generate Page Access Token with permissions:
#    pages_manage_posts, instagram_basic, instagram_content_publish
# 4. Get Page ID from Facebook Page → About → Page ID
# 5. Get IG User ID: GET /{page-id}?fields=instagram_business_account
FB_PAGE_ACCESS_TOKEN=
FB_PAGE_ID=
IG_USER_ID=

# ── Image Hosting (FREE) ──
# Get free API key at: https://api.imgbb.com/
# Used to host images temporarily for Instagram/Facebook (24hr expiry)
IMGBB_API_KEY=

# ── Token Expiry Dates ──
# Set these when you generate/refresh tokens (YYYY-MM-DD format)
# /health endpoint warns when within 7 days of expiry
# TOKEN_EXPIRY_LINKEDIN=2026-05-20
# TOKEN_EXPIRY_META=2026-05-20

# ── Dashboard ──
DASHBOARD_PORT=3000

# ── Automation API Key ──
# Random string for GitHub Actions → Dashboard authentication
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY=

# ── Cloudflare Access (production only) ──
# Set CF_ACCESS_ENABLED=true on your production server.
# Leave false for local development.
CF_ACCESS_ENABLED=false
CF_ACCESS_TEAM_DOMAIN=your-team-name
CF_ACCESS_AUD=your-application-audience-tag

# ── Optional ──
# TOPIC_OVERRIDE="Choosing hymns for a funeral service"
```

- [ ] **Step 2: Add `API_KEY` and `DASHBOARD_URL` to the list of GitHub Actions secrets needed**

Document in `.env.example` or a comment block.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: comprehensive credential setup guide in .env.example"
```

---

### Task 21: Update DEPLOYMENT.md

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add Chromium installation step**

After Node.js installation:
```bash
# Install Chromium for Puppeteer rendering
npx puppeteer browsers install chrome
```

- [ ] **Step 2: Add new environment variables to the deployment guide**

Document `API_KEY`, `TOKEN_EXPIRY_LINKEDIN`, `TOKEN_EXPIRY_META` in the `.env` setup section.

- [ ] **Step 3: Add token rotation instructions**

```markdown
## Token Rotation (every ~55 days)

LinkedIn and Meta tokens expire after ~60 days. Set calendar reminders.

1. Generate new token (LinkedIn Developer Portal / Meta Graph API Explorer)
2. SSH into VPS: `ssh ubuntu@your-vps-ip`
3. Edit .env: `nano /home/ubuntu/lcssocialmedia/.env`
4. Update the token value and TOKEN_EXPIRY_* date
5. Restart service: `sudo systemctl restart lcs-dashboard`
6. Check /health: `curl https://your-domain.com/health`
```

- [ ] **Step 4: Add GitHub Actions secrets setup**

```markdown
## GitHub Actions Secrets

Configure these in your repo → Settings → Secrets and variables → Actions:

- `DASHBOARD_URL` — Your dashboard domain (e.g., `https://lcs.yourdomain.com`)
- `API_KEY` — Same value as the API_KEY in your VPS .env file
```

- [ ] **Step 5: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs: update deployment guide with Chromium, token rotation, GitHub Actions setup"
```

---

### Task 22: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Start dashboard locally and verify**

Run: `npm run dashboard`
- Verify dashboard loads at http://localhost:3000
- Verify `/health` endpoint works
- Verify status filters include "Failed"
- Verify pause toggle works

- [ ] **Step 3: Verify no TikTok references remain**

Run: `grep -ri tiktok --include='*.js' --include='*.html' --include='*.yml' .`
Expected: No matches

- [ ] **Step 4: Final commit and push**

```bash
git status
git log --oneline -15
```

Verify all changes are committed and the branch is clean.

---

## Post-Implementation: Deployment Checklist

These steps are done manually on the VPS (not automatable in code):

- [ ] Create Oracle Cloud VPS (Always Free ARM A1)
- [ ] Install Node.js 20, Caddy, Chromium
- [ ] Clone repo, `npm install`, configure `.env`
- [ ] Start systemd service
- [ ] Configure Cloudflare DNS + Access
- [ ] Set GitHub Actions secrets (`DASHBOARD_URL`, `API_KEY`)
- [ ] Trigger `workflow_dispatch` and verify posts appear in dashboard
- [ ] Wait for scheduled time, verify auto-publish works
- [ ] Check `/health` endpoint
- [ ] Set up UptimeRobot for `/health` monitoring
