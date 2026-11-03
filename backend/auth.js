'use strict';

const bcrypt = require('bcryptjs');
const { db, ADMIN_EMAIL } = require('./db');
const { normalizeUnit } = require('./units');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isDesignatedAdmin(row) {
  if (!row) return false;
  return Number(row.is_admin) === 1 && normalizeEmail(row.email) === normalizeEmail(ADMIN_EMAIL);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    distanceUnit: normalizeUnit(row.distance_unit),
    isAdmin: isDesignatedAdmin(row),
  };
}

function validateCredentials(email, password) {
  const errors = [];
  const normalized = normalizeEmail(email);
  if (!normalized || !EMAIL_RE.test(normalized)) {
    errors.push('Enter a valid email address.');
  }
  if (!password || String(password).length < MIN_PASSWORD) {
    errors.push(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  return { email: normalized, password: String(password || ''), errors };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Please sign in.' });
  }
  const user = db
    .prepare('SELECT id, email, distance_unit, is_admin, created_at FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) {
    req.session = null;
    return res.status(401).json({ error: 'Please sign in.' });
  }
  req.user = user;
  next();
}

async function signup(email, password) {
  const { email: normalized, password: pwd, errors } = validateCredentials(email, password);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) {
    const err = new Error('An account with that email already exists.');
    err.status = 409;
    throw err;
  }
  const password_hash = await bcrypt.hash(pwd, 12);
  const info = db
    .prepare(`INSERT INTO users (email, password_hash, distance_unit) VALUES (?, ?, 'km')`)
    .run(normalized, password_hash);
  const row = db.prepare('SELECT id, email, distance_unit, is_admin, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  return publicUser(row);
}

async function login(email, password) {
  const normalized = normalizeEmail(email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (!user) {
    const err = new Error('Invalid email or password.');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    const err = new Error('Invalid email or password.');
    err.status = 401;
    throw err;
  }
  return publicUser(user);
}

module.exports = { requireAuth, signup, login, validateCredentials, normalizeEmail, publicUser, isDesignatedAdmin, ADMIN_EMAIL };
