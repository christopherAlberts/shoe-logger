'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const routes = require('./backend/routes');
const { uploadsDir } = require('./backend/db');

const PORT = Number(process.env.PORT) || 8096;
const SESSION_SECRET = process.env.SESSION_SECRET;

/** HTML/SW/manifest/JS/CSS: no-store so Cloudflare/browsers revalidate (SW cache is shoelogger-v8). */
const NO_STORE = 'no-cache, no-store, must-revalidate';
const CACHE_IMAGES = 'public, max-age=604800, immutable';

if (!SESSION_SECRET) {
  console.error('SESSION_SECRET is required. Copy .env.example to .env and set a secret.');
  process.exit(1);
}

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  cookieSession({
    name: 'shoelogger',
    keys: [SESSION_SECRET],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  })
);

function setPublicCacheHeaders(res, filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  if (
    base === 'sw.js' ||
    base === 'index.html' ||
    base === 'manifest.webmanifest' ||
    ext === '.html' ||
    ext === '.webmanifest'
  ) {
    res.setHeader('Cache-Control', NO_STORE);
    return;
  }

  if (ext === '.js' || ext === '.css') {
    res.setHeader('Cache-Control', NO_STORE);
    return;
  }

  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
    res.setHeader('Cache-Control', CACHE_IMAGES);
    return;
  }

  res.setHeader('Cache-Control', NO_STORE);
}

app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));
app.use(routes);
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: setPublicCacheHeaders,
  })
);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.setHeader('Cache-Control', NO_STORE);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = status < 500 ? err.message || 'Request failed.' : 'Something went wrong.';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`ShoeLogger listening on http://127.0.0.1:${PORT}`);
});

