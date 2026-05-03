const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

let db;

function initDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_snapshot (
      post_no TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      category TEXT,
      title TEXT NOT NULL,
      author TEXT,
      date_text TEXT,
      views_text TEXT,
      recommend_text TEXT,
      reply_count INTEGER NOT NULL DEFAULT 0,
      content_text TEXT NOT NULL,
      content_html TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_prediction (
      post_no TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      level TEXT NOT NULL,
      summary TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      signals_json TEXT NOT NULL,
      predictor_version TEXT NOT NULL,
      predicted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_label (
      post_no TEXT PRIMARY KEY,
      label TEXT NOT NULL CHECK(label IN ('troll', 'normal')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS label_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_no TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('set', 'clear')),
      from_label TEXT,
      to_label TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

module.exports = {
  DB_PATH,
  initDb
};
