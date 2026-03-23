// dashboard/migrations/001-add-error-tracking.js
export default function migrate(db) {
  // Add error tracking columns (check if they exist first for safety)
  const cols = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);

  if (!cols.includes('last_error')) {
    db.exec('ALTER TABLE posts ADD COLUMN last_error TEXT');
  }
  if (!cols.includes('retry_count')) {
    db.exec('ALTER TABLE posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  }

  // Add indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
  `);
}
