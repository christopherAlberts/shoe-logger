'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { db, uploadsDir, shoeTotals, recordNewUserNotification } = require('./db');
const { requireAuth, signup, login, publicUser, isDesignatedAdmin } = require('./auth');
const {
  WEAR_AMBER_KM,
  WEAR_RED_KM,
  MAX_RUN_KM,
  round3,
  normalizeUnit,
  parseDistanceKm,
} = require('./units');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this address. Try again later.' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed.'));
    }
    cb(null, true);
  },
});

async function saveShoePhoto(file) {
  if (!file) return null;
  const filename = `${uuidv4()}.webp`;
  const dest = path.join(uploadsDir, filename);
  await sharp(file.buffer)
    .rotate()
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dest);
  return filename;
}

function deletePhoto(photoPath) {
  if (!photoPath) return;
  const full = path.join(uploadsDir, path.basename(photoPath));
  if (fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch (_) {
      /* ignore */
    }
  }
}

function wearStatus(totalKm) {
  if (totalKm >= WEAR_RED_KM) return { level: 'replace', label: 'Replace', barClass: 'bar-red' };
  if (totalKm >= WEAR_AMBER_KM) return { level: 'replace-soon', label: 'Replace soon', barClass: 'bar-amber' };
  return { level: 'ok', label: null, barClass: 'bar-green' };
}

function enrichShoe(row) {
  const wear = wearStatus(row.total_km);
  return {
    id: row.id,
    name: row.name,
    photoUrl: row.photo_path ? `/uploads/${row.photo_path}` : null,
    shoeType: row.shoe_type,
    startingKm: round3(row.starting_km),
    loggedKm: round3(row.logged_km),
    totalKm: round3(row.total_km),
    retired: !!row.retired,
    createdAt: row.created_at,
    wearLevel: wear.level,
    wearLabel: wear.label,
    progressPct: Math.min(100, Math.round((row.total_km / WEAR_RED_KM) * 1000) / 10),
    barClass: wear.barClass,
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseRunKm(body) {
  return parseDistanceKm(body.km, { min: 0, max: MAX_RUN_KM, allowZero: false });
}

function parseSurface(value, { required = false, fallback = 'road' } = {}) {
  if (value == null || value === '') {
    if (required) {
      const err = new Error('surface must be "road" or "trail".');
      err.status = 400;
      throw err;
    }
    return fallback === 'trail' ? 'trail' : 'road';
  }
  const v = String(value).trim().toLowerCase();
  if (v !== 'road' && v !== 'trail') {
    const err = new Error('surface must be "road" or "trail".');
    err.status = 400;
    throw err;
  }
  return v;
}

function mapRun(row) {
  return {
    id: row.id,
    runDate: row.runDate ?? row.run_date,
    km: round3(row.km),
    surface: row.surface === 'trail' ? 'trail' : 'road',
    note: row.note ?? null,
    createdAt: row.createdAt ?? row.created_at,
  };
}

// --- Auth ---
router.get(
  '/api/me',
  asyncHandler(async (req, res) => {
    if (!req.session || !req.session.userId) {
      return res.json({ user: null });
    }
    const user = db
      .prepare('SELECT id, email, distance_unit, is_admin, created_at FROM users WHERE id = ?')
      .get(req.session.userId);
    if (!user) {
      req.session = null;
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user) });
  })
);

router.post(
  '/api/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const user = await signup(req.body.email, req.body.password);
    try {
      recordNewUserNotification(user.id, user.email);
    } catch (err) {
      console.error('Failed to record admin signup notification', err);
    }
    req.session.userId = user.id;
    res.status(201).json({ user });
  })
);

router.post(
  '/api/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const user = await login(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.json({ user });
  })
);

router.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

/**
 * Admin gate: re-reads the user from the DB on every request.
 * Requires an authenticated session, is_admin=1, AND email matching ADMIN_EMAIL.
 * 401 if logged out / unknown session user; 403 (no listing payload) otherwise.
 */
function requireAdmin(req, res, next) {
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
  if (!isDesignatedAdmin(user)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  req.user = user;
  next();
}

// --- Admin ---
router.get(
  '/api/admin/users',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const userCols = new Set(
      db.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
    );
    const hasName = userCols.has('name');
    const nameSelect = hasName ? 'u.name AS name,' : 'NULL AS name,';
    const rows = db
      .prepare(
        `SELECT
           u.id,
           u.email,
           ${nameSelect}
           u.created_at AS createdAt,
           (SELECT COUNT(*) FROM shoes s WHERE s.user_id = u.id) AS shoeCount,
           (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id) AS runCount,
           (SELECT COALESCE(SUM(r.km), 0) FROM runs r WHERE r.user_id = u.id) AS totalKm
         FROM users u
         ORDER BY u.created_at ASC, u.id ASC`
      )
      .all();
    res.json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name != null && String(row.name).trim() !== '' ? String(row.name) : null,
        createdAt: row.createdAt,
        shoeCount: Number(row.shoeCount) || 0,
        runCount: Number(row.runCount) || 0,
        totalKm: round3(row.totalKm),
      })),
    });
  })
);


router.get(
  '/api/admin/notifications',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, type, user_email AS userEmail, user_id AS userId,
                created_at AS createdAt, is_read AS isRead
         FROM admin_notifications
         ORDER BY created_at DESC, id DESC
         LIMIT 100`
      )
      .all();
    res.json({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        userEmail: row.userEmail,
        userId: row.userId,
        createdAt: row.createdAt,
        read: Number(row.isRead) === 1,
      })),
    });
  })
);

router.get(
  '/api/admin/notifications/unread-count',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read = 0')
      .get();
    res.json({ unreadCount: Number(row.c) || 0 });
  })
);

router.post(
  '/api/admin/notifications/mark-read',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.all === true) {
      db.prepare('UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0').run();
    } else if (Array.isArray(body.ids) && body.ids.length) {
      const ids = body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
      if (!ids.length) {
        return res.status(400).json({ error: 'ids must be positive integers.' });
      }
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE admin_notifications SET is_read = 1 WHERE id IN (${placeholders})`
      ).run(...ids);
    } else {
      return res.status(400).json({ error: 'Provide { all: true } or { ids: number[] }.' });
    }
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read = 0')
      .get();
    res.json({ ok: true, unreadCount: Number(row.c) || 0 });
  })
);

// --- Settings ---
router.patch(
  '/api/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const unit = normalizeUnit(req.body.distanceUnit);
    if (req.body.distanceUnit !== 'km' && req.body.distanceUnit !== 'mi') {
      return res.status(400).json({ error: 'distanceUnit must be "km" or "mi".' });
    }
    db.prepare('UPDATE users SET distance_unit = ? WHERE id = ?').run(unit, req.user.id);
    const user = db
      .prepare('SELECT id, email, distance_unit, is_admin, created_at FROM users WHERE id = ?')
      .get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

// --- Shoes ---
router.get(
  '/api/shoes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = shoeTotals(req.user.id);
    res.json({ shoes: rows.map(enrichShoe) });
  })
);

router.get(
  '/api/shoes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = shoeTotals(req.user.id, Number(req.params.id));
    if (!rows.length) return res.status(404).json({ error: 'Shoe not found.' });
    const shoe = enrichShoe(rows[0]);
    const runs = db
      .prepare(
        `SELECT id, run_date AS runDate, km, surface, note, created_at AS createdAt
         FROM runs WHERE shoe_id = ? AND user_id = ?
         ORDER BY run_date DESC, id DESC`
      )
      .all(shoe.id, req.user.id)
      .map(mapRun);
    res.json({ shoe, runs });
  })
);

router.post(
  '/api/shoes',
  requireAuth,
  (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
      if (err) {
        err.status = 400;
        return next(err);
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Shoe name is required.' });
    const shoeType = req.body.shoeType === 'trail' ? 'trail' : 'road';
    let startingKm = 0;
    if (req.body.startingKm != null && req.body.startingKm !== '') {
      startingKm = parseDistanceKm(req.body.startingKm, { min: 0, max: 100000, allowZero: true });
    }

    let photoPath = null;
    try {
      photoPath = await saveShoePhoto(req.file);
    } catch (e) {
      return res.status(400).json({ error: 'Could not process that image. Try a JPG or PNG under 5 MB.' });
    }

    const info = db
      .prepare(
        `INSERT INTO shoes (user_id, name, photo_path, shoe_type, starting_km)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.user.id, name, photoPath, shoeType, startingKm);

    const rows = shoeTotals(req.user.id, info.lastInsertRowid);
    res.status(201).json({ shoe: enrichShoe(rows[0]) });
  })
);

router.patch(
  '/api/shoes/:id',
  requireAuth,
  (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
      if (err) {
        err.status = 400;
        return next(err);
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const shoe = db.prepare('SELECT * FROM shoes WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!shoe) return res.status(404).json({ error: 'Shoe not found.' });

    const name = req.body.name != null ? String(req.body.name).trim() : shoe.name;
    if (!name) return res.status(400).json({ error: 'Shoe name is required.' });
    const shoeType =
      req.body.shoeType != null ? (req.body.shoeType === 'trail' ? 'trail' : 'road') : shoe.shoe_type;
    let startingKm = shoe.starting_km;
    if (req.body.startingKm != null && req.body.startingKm !== '') {
      startingKm = parseDistanceKm(req.body.startingKm, { min: 0, max: 100000, allowZero: true });
    }
    let retired = shoe.retired;
    if (req.body.retired != null) {
      retired = req.body.retired === true || req.body.retired === 'true' || req.body.retired === '1' ? 1 : 0;
    }

    let photoPath = shoe.photo_path;
    if (req.file) {
      try {
        const nextPhoto = await saveShoePhoto(req.file);
        deletePhoto(photoPath);
        photoPath = nextPhoto;
      } catch (_) {
        return res.status(400).json({ error: 'Could not process that image.' });
      }
    }

    db.prepare(
      `UPDATE shoes SET name = ?, photo_path = ?, shoe_type = ?, starting_km = ?, retired = ?
       WHERE id = ? AND user_id = ?`
    ).run(name, photoPath, shoeType, startingKm, retired, shoe.id, req.user.id);

    const rows = shoeTotals(req.user.id, shoe.id);
    res.json({ shoe: enrichShoe(rows[0]) });
  })
);

router.delete(
  '/api/shoes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shoe = db.prepare('SELECT * FROM shoes WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!shoe) return res.status(404).json({ error: 'Shoe not found.' });
    db.prepare('DELETE FROM shoes WHERE id = ? AND user_id = ?').run(shoe.id, req.user.id);
    deletePhoto(shoe.photo_path);
    res.json({ ok: true });
  })
);

// --- Runs ---
router.post(
  '/api/shoes/:id/runs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shoe = db.prepare('SELECT * FROM shoes WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!shoe) return res.status(404).json({ error: 'Shoe not found.' });

    const km = parseRunKm(req.body);
    const runDate = String(req.body.runDate || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      return res.status(400).json({ error: 'Invalid date.' });
    }
    const note = req.body.note != null ? String(req.body.note).trim().slice(0, 500) : null;
    const surface = parseSurface(req.body.surface, { fallback: shoe.shoe_type || 'road' });

    const info = db
      .prepare(`INSERT INTO runs (shoe_id, user_id, run_date, km, surface, note) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(shoe.id, req.user.id, runDate, km, surface, note || null);

    const run = mapRun(
      db
        .prepare(`SELECT id, run_date AS runDate, km, surface, note, created_at AS createdAt FROM runs WHERE id = ?`)
        .get(info.lastInsertRowid)
    );
    const rows = shoeTotals(req.user.id, shoe.id);
    res.status(201).json({ run, shoe: enrichShoe(rows[0]) });
  })
);

router.patch(
  '/api/runs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    let km = run.km;
    if (req.body.km != null) {
      km = parseRunKm(req.body);
    }
    let runDate = run.run_date;
    if (req.body.runDate != null) {
      runDate = String(req.body.runDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
        return res.status(400).json({ error: 'Invalid date.' });
      }
    }
    let note = run.note;
    if (req.body.note !== undefined) {
      note = req.body.note == null ? null : String(req.body.note).trim().slice(0, 500) || null;
    }
    let surface = run.surface === 'trail' ? 'trail' : 'road';
    if (req.body.surface !== undefined) {
      surface = parseSurface(req.body.surface, { required: true });
    }

    db.prepare(`UPDATE runs SET run_date = ?, km = ?, surface = ?, note = ? WHERE id = ? AND user_id = ?`).run(
      runDate,
      km,
      surface,
      note,
      run.id,
      req.user.id
    );

    const updated = mapRun(
      db
        .prepare(`SELECT id, run_date AS runDate, km, surface, note, created_at AS createdAt FROM runs WHERE id = ?`)
        .get(run.id)
    );
    const rows = shoeTotals(req.user.id, run.shoe_id);
    res.json({ run: updated, shoe: enrichShoe(rows[0]) });
  })
);

router.delete(
  '/api/runs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!run) return res.status(404).json({ error: 'Run not found.' });
    db.prepare('DELETE FROM runs WHERE id = ? AND user_id = ?').run(run.id, req.user.id);
    const rows = shoeTotals(req.user.id, run.shoe_id);
    res.json({ ok: true, shoe: enrichShoe(rows[0]) });
  })
);

module.exports = router;
