'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
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
  const user = db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(req.session.userId);
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
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalized, password_hash);
  return { id: info.lastInsertRowid, email: normalized };
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
  return { id: user.id, email: user.email };
}

module.exports = { requireAuth, signup, login, validateCredentials, normalizeEmail };
