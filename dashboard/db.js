// dashboard/db.js
// SQLite database for draft post management

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import migrate001 from './migrations/001-add-error-tracking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'dashboard.db');

import fs from 'fs';
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ──

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
`);

// ── Default settings ──

const defaultSettings = {
  recurring_days: JSON.stringify(['monday', 'thursday']),
  recurring_time: '09:00',
  batch_size: '5',
};

const upsertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [key, value] of Object.entries(defaultSettings)) {
  upsertSetting.run(key, value);
}

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

const migrations = [migrate001];

const currentVersion = getCurrentVersion();
for (let i = currentVersion; i < migrations.length; i++) {
  console.log(`Running migration ${i + 1}...`);
  migrations[i](db);
  setVersion(i + 1);
}

// ── Queries ──

export const queries = {
  // Posts
  getAllPosts: db.prepare(
    'SELECT * FROM posts ORDER BY CASE status WHEN \'draft\' THEN 1 WHEN \'approved\' THEN 2 WHEN \'scheduled\' THEN 3 WHEN \'publishing\' THEN 3 WHEN \'failed\' THEN 4 WHEN \'published\' THEN 5 WHEN \'rejected\' THEN 6 END, created_at DESC'
  ),

  getPostsByStatus: db.prepare(
    'SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC'
  ),

  getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),

  createPost: db.prepare(`
    INSERT INTO posts (topic, template, caption, slides, status, platforms)
    VALUES (@topic, @template, @caption, @slides, @status, @platforms)
  `),

  updatePost: db.prepare(`
    UPDATE posts SET
      topic = @topic,
      template = @template,
      caption = @caption,
      caption_linkedin = @caption_linkedin,
      caption_instagram = @caption_instagram,
      caption_facebook = @caption_facebook,
      slides = @slides,
      status = @status,
      scheduled_at = @scheduled_at,
      platforms = @platforms,
      rendered = @rendered,
      updated_at = datetime('now')
    WHERE id = @id
  `),

  updatePostStatus: db.prepare(`
    UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?
  `),

  updatePostSchedule: db.prepare(`
    UPDATE posts SET scheduled_at = ?, status = 'scheduled', updated_at = datetime('now') WHERE id = ?
  `),

  deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),

  getDuePosts: db.prepare(`
    SELECT * FROM posts
    WHERE status = 'scheduled'
    AND scheduled_at <= datetime('now')
    ORDER BY scheduled_at ASC
  `),

  // Error tracking
  updatePostError: db.prepare(
    "UPDATE posts SET last_error = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?"
  ),
  clearPostError: db.prepare(
    "UPDATE posts SET last_error = NULL, retry_count = 0, updated_at = datetime('now') WHERE id = ?"
  ),
  getFailedPosts: db.prepare(
    "SELECT * FROM posts WHERE status = 'failed' ORDER BY updated_at DESC"
  ),

  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ),
  getAllSettings: db.prepare('SELECT * FROM settings'),
};

export default db;
