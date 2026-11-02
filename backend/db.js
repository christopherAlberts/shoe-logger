'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const dbPath = path.join(dataDir, 'app.db');

fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    photo_path TEXT,
    shoe_type TEXT NOT NULL DEFAULT 'road' CHECK (shoe_type IN ('road', 'trail')),
    starting_km REAL NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shoe_id INTEGER NOT NULL REFERENCES shoes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_date TEXT NOT NULL,
    km REAL NOT NULL CHECK (km > 0),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_shoes_user ON shoes(user_id);
  CREATE INDEX IF NOT EXISTS idx_runs_shoe ON runs(shoe_id);
  CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
`);

function shoeTotals(userId, shoeId = null) {
  const params = [userId];
  let where = 's.user_id = ?';
  if (shoeId != null) {
    where += ' AND s.id = ?';
    params.push(shoeId);
  }
  return db
    .prepare(
      `SELECT
         s.id,
         s.user_id,
         s.name,
         s.photo_path,
         s.shoe_type,
         s.starting_km,
         s.retired,
         s.created_at,
         COALESCE(SUM(r.km), 0) AS logged_km,
         (s.starting_km + COALESCE(SUM(r.km), 0)) AS total_km
       FROM shoes s
       LEFT JOIN runs r ON r.shoe_id = s.id
       WHERE ${where}
       GROUP BY s.id
       ORDER BY s.retired ASC, s.created_at DESC`
    )
    .all(...params);
}

module.exports = { db, dataDir, uploadsDir, shoeTotals };
