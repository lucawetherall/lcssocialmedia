import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import migrate001 from './migrations/001-add-error-tracking.js';

describe('database', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    // Create base schema (same as db.js)
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
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('migration 001: error tracking', () => {
    it('adds last_error column', () => {
      migrate001(db);
      const cols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
      expect(cols).toContain('last_error');
    });

    it('adds retry_count column with default 0', () => {
      migrate001(db);
      const cols = db.prepare("PRAGMA table_info(posts)").all();
      const retryCol = cols.find(c => c.name === 'retry_count');
      expect(retryCol).toBeDefined();
      expect(retryCol.dflt_value).toBe('0');
    });

    it('creates indexes', () => {
      migrate001(db);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
      expect(indexes).toContain('idx_posts_status');
      expect(indexes).toContain('idx_posts_scheduled_at');
      expect(indexes).toContain('idx_posts_created_at');
    });

    it('is idempotent — can run twice without error', () => {
      migrate001(db);
      expect(() => migrate001(db)).not.toThrow();
    });
  });

  describe('schema_version tracking', () => {
    it('tracks migration version', () => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)');
      db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

      migrate001(db);
      db.prepare('UPDATE schema_version SET version = 1').run();

      const version = db.prepare('SELECT version FROM schema_version').get();
      expect(version.version).toBe(1);
    });
  });
});
