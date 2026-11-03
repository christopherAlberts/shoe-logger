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
    distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi')),
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
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
    surface TEXT NOT NULL DEFAULT 'road' CHECK (surface IN ('road', 'trail')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_shoes_user ON shoes(user_id);
  CREATE INDEX IF NOT EXISTS idx_runs_shoe ON runs(shoe_id);
  CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);

  CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('new_user')),
    user_email TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1))
  );

  CREATE INDEX IF NOT EXISTS idx_admin_notifications_read ON admin_notifications(is_read, created_at);
`);

function backupDatabase() {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dataDir, `app.db.bak-${stamp}`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function tableColumns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function ensureMigrations() {
  const userCols = tableColumns('users');
  if (!userCols.has('distance_unit')) {
    const backup = backupDatabase();
    if (backup) console.log(`DB backup before migration: ${backup}`);
    db.exec(`ALTER TABLE users ADD COLUMN distance_unit TEXT NOT NULL DEFAULT 'km'`);
    console.log("Migration: added users.distance_unit (default 'km')");
  }

  const shoeCols = tableColumns('shoes');
  if (!shoeCols.has('shoe_type')) {
    const backup = backupDatabase();
    if (backup) console.log(`DB backup before migration: ${backup}`);
    db.exec(`ALTER TABLE shoes ADD COLUMN shoe_type TEXT NOT NULL DEFAULT 'road'`);
    console.log("Migration: added shoes.shoe_type (default 'road')");
  }

  const runCols = tableColumns('runs');
  if (!runCols.has('surface')) {
    const backup = backupDatabase();
    if (backup) console.log(`DB backup before migration: ${backup}`);
    db.exec(`ALTER TABLE runs ADD COLUMN surface TEXT NOT NULL DEFAULT 'road'`);
    db.exec(`
      UPDATE runs
      SET surface = COALESCE(
        (SELECT shoe_type FROM shoes WHERE shoes.id = runs.shoe_id),
        'road'
      )
    `);
    console.log("Migration: added runs.surface (default from shoe_type)");
  }

  const userColsAfter = tableColumns('users');
  if (!userColsAfter.has('is_admin')) {
    const backup = backupDatabase();
    if (backup) console.log(`DB backup before migration: ${backup}`);
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
    console.log("Migration: added users.is_admin (default 0)");
  }

  const notifTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_notifications'"
  ).get();
  if (!notifTables) {
    const backup = backupDatabase();
    if (backup) console.log(`DB backup before migration: ${backup}`);
    db.exec(`
      CREATE TABLE admin_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('new_user')),
        user_email TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS idx_admin_notifications_read
        ON admin_notifications(is_read, created_at);
    `);
    console.log('Migration: created admin_notifications');
  }
}

/** Sole admin account — never grant via signup. */
const ADMIN_EMAIL = 'christopher.alberts0@gmail.com';

function ensureAdminFlags() {
  const cols = tableColumns('users');
  if (!cols.has('is_admin')) return;
  // Reset everyone, then promote only the designated admin (case-insensitive).
  db.prepare('UPDATE users SET is_admin = 0').run();
  const info = db
    .prepare('UPDATE users SET is_admin = 1 WHERE lower(email) = lower(?)')
    .run(ADMIN_EMAIL);
  if (info.changes > 0) {
    console.log(`Admin flag set for ${ADMIN_EMAIL}`);
  } else {
    console.log(`Admin email ${ADMIN_EMAIL} not found; no admin users`);
  }
}

ensureMigrations();
ensureAdminFlags();

function recordNewUserNotification(userId, email) {
  db.prepare(
    `INSERT INTO admin_notifications (type, user_email, user_id, is_read)
     VALUES ('new_user', ?, ?, 0)`
  ).run(String(email), userId == null ? null : Number(userId));
}


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

module.exports = { db, dataDir, uploadsDir, shoeTotals, backupDatabase, dbPath, ADMIN_EMAIL, ensureAdminFlags, recordNewUserNotification };
