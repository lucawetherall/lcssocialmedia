import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

describe('server integration', () => {
  let db;
  let queries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // Replicate schema from db.js + migrations
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
        last_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
      CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);
    `);

    // Prepare queries (subset of what db.js provides)
    queries = {
      createPost: db.prepare(`
        INSERT INTO posts (topic, template, caption, slides, status, platforms)
        VALUES (@topic, @template, @caption, @slides, @status, @platforms)
      `),
      getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
      getAllPosts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC'),
      updatePostStatus: db.prepare("UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?"),
      updatePostSchedule: db.prepare("UPDATE posts SET scheduled_at = ?, status = 'scheduled', updated_at = datetime('now') WHERE id = ?"),
      updatePostError: db.prepare("UPDATE posts SET last_error = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?"),
      clearPostError: db.prepare("UPDATE posts SET last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"),
      getDuePosts: db.prepare("SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC"),
      setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
      getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
      getAllSettings: db.prepare('SELECT * FROM settings'),
      recordTopicUsage: db.prepare('INSERT INTO topic_history (topic) VALUES (?)'),
      getRecentTopics: db.prepare("SELECT DISTINCT topic FROM topic_history WHERE used_at > datetime('now', '-30 days')"),
    };
  });

  afterEach(() => {
    db.close();
  });

  describe('post lifecycle', () => {
    it('creates a post in draft status', () => {
      const result = queries.createPost.run({
        topic: 'Test topic',
        template: 'listicle',
        caption: 'Test caption',
        slides: '[]',
        status: 'draft',
        platforms: '["linkedin","instagram","facebook"]',
      });
      const post = queries.getPost.get(result.lastInsertRowid);
      expect(post.status).toBe('draft');
      expect(post.topic).toBe('Test topic');
    });

    it('transitions draft -> approved -> scheduled -> published', () => {
      const result = queries.createPost.run({
        topic: 'Lifecycle test', template: 'listicle', caption: '', slides: '[]',
        status: 'draft', platforms: '["linkedin"]',
      });
      const id = result.lastInsertRowid;

      queries.updatePostStatus.run('approved', id);
      expect(queries.getPost.get(id).status).toBe('approved');

      queries.updatePostSchedule.run('2026-03-25 09:00:00', id);
      expect(queries.getPost.get(id).status).toBe('scheduled');

      queries.updatePostStatus.run('published', id);
      expect(queries.getPost.get(id).status).toBe('published');
    });

    it('tracks error recovery with retry count', () => {
      const result = queries.createPost.run({
        topic: 'Error test', template: 'listicle', caption: '', slides: '[]',
        status: 'scheduled', platforms: '["linkedin"]',
      });
      const id = result.lastInsertRowid;

      // First failure
      queries.updatePostError.run('Connection timeout', id);
      let post = queries.getPost.get(id);
      expect(post.retry_count).toBe(1);
      expect(post.last_error).toBe('Connection timeout');

      // Second failure
      queries.updatePostError.run('Rate limited', id);
      post = queries.getPost.get(id);
      expect(post.retry_count).toBe(2);
      expect(post.last_error).toBe('Rate limited');

      // Third failure -> permanent
      queries.updatePostError.run('Auth expired', id);
      queries.updatePostStatus.run('failed', id);
      post = queries.getPost.get(id);
      expect(post.retry_count).toBe(3);
      expect(post.status).toBe('failed');
    });

    it('clears error on successful publish', () => {
      const result = queries.createPost.run({
        topic: 'Recovery test', template: 'listicle', caption: '', slides: '[]',
        status: 'scheduled', platforms: '["linkedin"]',
      });
      const id = result.lastInsertRowid;

      queries.updatePostError.run('Transient error', id);
      queries.clearPostError.run(id);

      const post = queries.getPost.get(id);
      expect(post.retry_count).toBe(0);
      expect(post.last_error).toBeNull();
    });
  });

  describe('scheduled post queries', () => {
    it('getDuePosts returns only scheduled posts that are due', () => {
      // Past scheduled post (due)
      queries.createPost.run({
        topic: 'Due post', template: 'listicle', caption: '', slides: '[]',
        status: 'draft', platforms: '["linkedin"]',
      });
      queries.updatePostSchedule.run('2020-01-01 09:00:00', 1);

      // Future scheduled post (not due)
      queries.createPost.run({
        topic: 'Future post', template: 'listicle', caption: '', slides: '[]',
        status: 'draft', platforms: '["linkedin"]',
      });
      queries.updatePostSchedule.run('2099-01-01 09:00:00', 2);

      // Non-scheduled post
      queries.createPost.run({
        topic: 'Draft post', template: 'listicle', caption: '', slides: '[]',
        status: 'draft', platforms: '["linkedin"]',
      });

      const due = queries.getDuePosts.all();
      expect(due).toHaveLength(1);
      expect(due[0].topic).toBe('Due post');
    });

    it('publishing status prevents re-pickup', () => {
      queries.createPost.run({
        topic: 'Publishing', template: 'listicle', caption: '', slides: '[]',
        status: 'draft', platforms: '["linkedin"]',
      });
      queries.updatePostSchedule.run('2020-01-01 09:00:00', 1);

      // Set to publishing (simulating in-progress)
      queries.updatePostStatus.run('publishing', 1);

      const due = queries.getDuePosts.all();
      expect(due).toHaveLength(0); // Not picked up because it's 'publishing', not 'scheduled'
    });
  });

  describe('settings', () => {
    it('stores and retrieves settings', () => {
      queries.setSetting.run('test_key', 'test_value');
      const result = queries.getSetting.get('test_key');
      expect(result.value).toBe('test_value');
    });

    it('handles JSON values in settings', () => {
      queries.setSetting.run('recurring_days', JSON.stringify(['monday', 'thursday']));
      const result = queries.getSetting.get('recurring_days');
      expect(JSON.parse(result.value)).toEqual(['monday', 'thursday']);
    });

    it('upserts settings on duplicate key', () => {
      queries.setSetting.run('key', 'value1');
      queries.setSetting.run('key', 'value2');
      expect(queries.getSetting.get('key').value).toBe('value2');
    });
  });

  describe('topic history', () => {
    it('records topic usage', () => {
      queries.recordTopicUsage.run('Choosing hymns for a funeral');
      const recent = queries.getRecentTopics.all();
      expect(recent).toHaveLength(1);
      expect(recent[0].topic).toBe('Choosing hymns for a funeral');
    });

    it('returns distinct topics only', () => {
      queries.recordTopicUsage.run('Same topic');
      queries.recordTopicUsage.run('Same topic');
      const recent = queries.getRecentTopics.all();
      expect(recent).toHaveLength(1);
    });
  });

  describe('health endpoint data', () => {
    it('returns correct counts', () => {
      // Create posts in various states
      queries.createPost.run({ topic: 'A', template: 'listicle', caption: '', slides: '[]', status: 'approved', platforms: '[]' });
      queries.createPost.run({ topic: 'B', template: 'listicle', caption: '', slides: '[]', status: 'scheduled', platforms: '[]' });
      queries.createPost.run({ topic: 'C', template: 'listicle', caption: '', slides: '[]', status: 'published', platforms: '[]' });
      queries.createPost.run({ topic: 'D', template: 'listicle', caption: '', slides: '[]', status: 'failed', platforms: '[]' });

      const pending = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status IN ('approved', 'scheduled')").get();
      const failed = db.prepare("SELECT COUNT(*) as count FROM posts WHERE status = 'failed'").get();

      expect(pending.count).toBe(2);
      expect(failed.count).toBe(1);
    });
  });
});
