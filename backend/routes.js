'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { db, uploadsDir, shoeTotals } = require('./db');
const { requireAuth, signup, login } = require('./auth');

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
  if (totalKm >= 800) return { level: 'replace', label: 'Replace', barClass: 'bar-red' };
  if (totalKm >= 500) return { level: 'replace-soon', label: 'Replace soon', barClass: 'bar-amber' };
  return { level: 'ok', label: null, barClass: 'bar-green' };
}

function enrichShoe(row) {
  const wear = wearStatus(row.total_km);
  return {
    id: row.id,
    name: row.name,
    photoUrl: row.photo_path ? `/uploads/${row.photo_path}` : null,
    shoeType: row.shoe_type,
    startingKm: row.starting_km,
    loggedKm: row.logged_km,
    totalKm: Math.round(row.total_km * 100) / 100,
    retired: !!row.retired,
    createdAt: row.created_at,
    wearLevel: wear.level,
    wearLabel: wear.label,
    progressPct: Math.min(100, Math.round((row.total_km / 800) * 1000) / 10),
    barClass: wear.barClass,
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// --- Auth ---
router.get(
  '/api/me',
  asyncHandler(async (req, res) => {
    if (!req.session || !req.session.userId) {
      return res.json({ user: null });
    }
    const user = db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      req.session = null;
      return res.json({ user: null });
    }
    res.json({ user: { id: user.id, email: user.email, createdAt: user.created_at } });
  })
);

router.post(
  '/api/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const user = await signup(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.status(201).json({ user: { id: user.id, email: user.email } });
  })
);

router.post(
  '/api/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const user = await login(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email } });
  })
);

router.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

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
        `SELECT id, run_date AS runDate, km, note, created_at AS createdAt
         FROM runs WHERE shoe_id = ? AND user_id = ?
         ORDER BY run_date DESC, id DESC`
      )
      .all(shoe.id, req.user.id);
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
    let startingKm = Number(req.body.startingKm || 0);
    if (!Number.isFinite(startingKm) || startingKm < 0) startingKm = 0;

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
      startingKm = Number(req.body.startingKm);
      if (!Number.isFinite(startingKm) || startingKm < 0) {
        return res.status(400).json({ error: 'Starting km must be zero or positive.' });
      }
    }
    let retired = shoe.retired;
    if (req.body.retired != null) {
      retired = req.body.retired === true || req.body.retired === 'true' || req.body.retired === '1' ? 1 : 0;
    }

    let photoPath = shoe.photo_path;
    if (req.file) {
      try {
        const next = await saveShoePhoto(req.file);
        deletePhoto(photoPath);
        photoPath = next;
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

    const km = Number(req.body.km);
    if (!Number.isFinite(km) || km <= 0 || km > 500) {
      return res.status(400).json({ error: 'Enter a distance between 0 and 500 km.' });
    }
    const runDate = String(req.body.runDate || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      return res.status(400).json({ error: 'Invalid date.' });
    }
    const note = req.body.note != null ? String(req.body.note).trim().slice(0, 500) : null;

    const info = db
      .prepare(`INSERT INTO runs (shoe_id, user_id, run_date, km, note) VALUES (?, ?, ?, ?, ?)`)
      .run(shoe.id, req.user.id, runDate, km, note || null);

    const run = db
      .prepare(
        `SELECT id, run_date AS runDate, km, note, created_at AS createdAt FROM runs WHERE id = ?`
      )
      .get(info.lastInsertRowid);
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
      km = Number(req.body.km);
      if (!Number.isFinite(km) || km <= 0 || km > 500) {
        return res.status(400).json({ error: 'Enter a distance between 0 and 500 km.' });
      }
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

    db.prepare(`UPDATE runs SET run_date = ?, km = ?, note = ? WHERE id = ? AND user_id = ?`).run(
      runDate,
      km,
      note,
      run.id,
      req.user.id
    );

    const updated = db
      .prepare(
        `SELECT id, run_date AS runDate, km, note, created_at AS createdAt FROM runs WHERE id = ?`
      )
      .get(run.id);
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
