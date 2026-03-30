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
