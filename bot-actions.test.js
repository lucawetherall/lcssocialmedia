import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import migrate001 from './migrations/001-add-error-tracking.js';
import migrate002 from './migrations/002-add-topic-history.js';

// ── Mock heavy dependencies ──

vi.mock('./content-generator.js', () => ({
  generateCarouselContent: vi.fn().mockResolvedValue({
    topic: 'Test Topic',
    caption: 'Test caption text',
    slides: [
      { type: 'hook', headline: 'Hook', body: 'Body 1', icon: '1', footnote: '' },
      { type: 'content', headline: 'Content', body: 'Body 2', icon: '2', footnote: '' },
    ],
  }),
}));

vi.mock('./render-helper.js', () => ({
  renderPostSlides: vi.fn().mockResolvedValue(['slide-01.png', 'slide-02.png']),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./poster.js', () => ({
  publishToAllPlatforms: vi.fn().mockResolvedValue({
    results: [
      { platform: 'linkedin', success: true },
      { platform: 'instagram', success: true },
      { platform: 'facebook', success: true },
    ],
    allSucceeded: true,
    failedPlatforms: [],
  }),
}));

vi.mock('./utils/token-expiry.js', () => ({
  checkTokenExpiry: vi.fn().mockReturnValue([]),
}));

// ── Create in-memory DB before importing bot-actions ──

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'listicle',
      caption TEXT NOT NULL DEFAULT '',
      caption_linkedin TEXT,
      caption_instagram TEXT,
      caption_facebook TEXT,
      slides TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TEXT,
      platforms TEXT NOT NULL DEFAULT '["linkedin","instagram","facebook"]',
      rendered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL DEFAULT 0
    );
  `);

  migrate001(db);
  migrate002(db);

  // Default settings
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  upsert.run('recurring_days', JSON.stringify(['monday', 'thursday']));
  upsert.run('recurring_time', '09:00');
  upsert.run('batch_size', '5');

  return db;
}

function createQueries(db) {
  return {
    getAllPosts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC'),
    getPostsByStatus: db.prepare('SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC'),
    getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
    createPost: db.prepare(`
      INSERT INTO posts (topic, template, caption, slides, status, platforms)
      VALUES (@topic, @template, @caption, @slides, @status, @platforms)
    `),
    updatePost: db.prepare(`
      UPDATE posts SET
        topic = @topic, template = @template, caption = @caption,
        caption_linkedin = @caption_linkedin, caption_instagram = @caption_instagram,
        caption_facebook = @caption_facebook, slides = @slides, status = @status,
        scheduled_at = @scheduled_at, platforms = @platforms, rendered = @rendered,
        updated_at = datetime('now')
      WHERE id = @id
    `),
    updatePostStatus: db.prepare("UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?"),
    updatePostSchedule: db.prepare("UPDATE posts SET scheduled_at = ?, status = 'scheduled', updated_at = datetime('now') WHERE id = ?"),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    getDuePosts: db.prepare("SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"),
    updatePostError: db.prepare("UPDATE posts SET last_error = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?"),
    clearPostError: db.prepare("UPDATE posts SET last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"),
    getFailedPosts: db.prepare("SELECT * FROM posts WHERE status = 'failed' ORDER BY updated_at DESC"),
    recordTopicUsage: db.prepare('INSERT INTO topic_history (topic) VALUES (?)'),
    getRecentTopics: db.prepare("SELECT DISTINCT topic FROM topic_history WHERE used_at > datetime('now', '-30 days')"),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
    getAllSettings: db.prepare('SELECT * FROM settings'),
  };
}

function insertTestPost(queries, overrides = {}) {
  const defaults = {
    topic: 'Test Topic',
    template: 'listicle',
    caption: 'Test caption',
    slides: JSON.stringify([{ type: 'hook', headline: 'H', body: 'B', icon: '1', footnote: '' }]),
    status: 'draft',
    platforms: JSON.stringify(['linkedin', 'instagram', 'facebook']),
  };
  const data = { ...defaults, ...overrides };
  const result = queries.createPost.run(data);
  return Number(result.lastInsertRowid);
}

// Import parsePost directly — it's a pure function
import { parsePost } from './bot-actions.js';

// ── Tests ──

describe('parsePost', () => {
  it('returns null for null input', () => {
    expect(parsePost(null)).toBeNull();
  });

  it('parses slides and platforms from JSON strings', () => {
    const row = {
      id: 1,
      topic: 'Test',
      slides: '[{"type":"hook"}]',
      platforms: '["linkedin"]',
      caption: 'Hello',
    };
    const result = parsePost(row);
    expect(result.slides).toEqual([{ type: 'hook' }]);
    expect(result.platforms).toEqual(['linkedin']);
  });

  it('handles empty/missing JSON gracefully', () => {
    const row = { id: 1, slides: '', platforms: '' };
    const result = parsePost(row);
    expect(result.slides).toEqual([]);
    expect(result.platforms).toEqual([]);
  });
});

describe('post actions (with in-memory DB)', () => {
  let db;
  let queries;

  beforeEach(() => {
    db = createTestDb();
    queries = createQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('approve / reject / schedule', () => {
    it('approves a draft post', () => {
      const postId = insertTestPost(queries);
      queries.updatePostStatus.run('approved', postId);
      const post = queries.getPost.get(postId);
      expect(post.status).toBe('approved');
    });

    it('rejects a draft post', () => {
      const postId = insertTestPost(queries);
      queries.updatePostStatus.run('rejected', postId);
      const post = queries.getPost.get(postId);
      expect(post.status).toBe('rejected');
    });

    it('schedules a post with a datetime', () => {
      const postId = insertTestPost(queries, { status: 'approved' });
      queries.updatePostSchedule.run('2026-04-06 09:00:00', postId);
      const post = queries.getPost.get(postId);
      expect(post.status).toBe('scheduled');
      expect(post.scheduled_at).toBe('2026-04-06 09:00:00');
    });
  });

  describe('caption updates', () => {
    it('updates global caption', () => {
      const postId = insertTestPost(queries);
      const post = parsePost(queries.getPost.get(postId));
      post.caption = 'New global caption';
      queries.updatePost.run({
        ...post,
        slides: JSON.stringify(post.slides),
        platforms: JSON.stringify(post.platforms),
        rendered: post.rendered,
      });

      const updated = queries.getPost.get(postId);
      expect(updated.caption).toBe('New global caption');
    });

    it('updates per-platform caption', () => {
      const postId = insertTestPost(queries);
      const post = parsePost(queries.getPost.get(postId));
      post.caption_linkedin = 'LinkedIn-specific caption';
      queries.updatePost.run({
        ...post,
        slides: JSON.stringify(post.slides),
        platforms: JSON.stringify(post.platforms),
        rendered: post.rendered,
      });

      const updated = queries.getPost.get(postId);
      expect(updated.caption_linkedin).toBe('LinkedIn-specific caption');
    });
  });

  describe('scheduled post publishing', () => {
    it('finds due posts', () => {
      const postId = insertTestPost(queries, { status: 'approved' });
      // Schedule in the past so it's due
      queries.updatePostSchedule.run('2020-01-01 09:00:00', postId);
      const duePosts = queries.getDuePosts.all();
      expect(duePosts).toHaveLength(1);
      expect(duePosts[0].id).toBe(postId);
    });

    it('does not find future posts', () => {
      const postId = insertTestPost(queries, { status: 'approved' });
      queries.updatePostSchedule.run('2099-01-01 09:00:00', postId);
      const duePosts = queries.getDuePosts.all();
      expect(duePosts).toHaveLength(0);
    });

    it('tracks retry count on failure', () => {
      const postId = insertTestPost(queries);
      queries.updatePostError.run('Network error', postId);
      let post = queries.getPost.get(postId);
      expect(post.retry_count).toBe(1);
      expect(post.last_error).toBe('Network error');

      queries.updatePostError.run('Network error again', postId);
      post = queries.getPost.get(postId);
      expect(post.retry_count).toBe(2);
    });

    it('clears error on success', () => {
      const postId = insertTestPost(queries);
      queries.updatePostError.run('Some error', postId);
      queries.clearPostError.run(postId);
      const post = queries.getPost.get(postId);
      expect(post.retry_count).toBe(0);
      expect(post.last_error).toBeNull();
    });
  });

  describe('topic history', () => {
    it('records topic usage', () => {
      queries.recordTopicUsage.run('Funeral Planning');
      const recent = queries.getRecentTopics.all();
      expect(recent.map(r => r.topic)).toContain('Funeral Planning');
    });

    it('returns distinct topics', () => {
      queries.recordTopicUsage.run('Weddings');
      queries.recordTopicUsage.run('Weddings');
      const recent = queries.getRecentTopics.all();
      const weddingEntries = recent.filter(r => r.topic === 'Weddings');
      expect(weddingEntries).toHaveLength(1);
    });
  });

  describe('delete post', () => {
    it('removes post from database', () => {
      const postId = insertTestPost(queries);
      expect(queries.getPost.get(postId)).toBeDefined();
      queries.deletePost.run(postId);
      expect(queries.getPost.get(postId)).toBeUndefined();
    });
  });
});
