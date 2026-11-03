'use strict';

const webpush = require('web-push');
const { db } = require('./db');

let configured = false;

function configurePushFromEnv() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:christopher.alberts0@gmail.com';
  if (!publicKey || !privateKey) {
    configured = false;
    console.warn('Web Push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set');
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function isPushConfigured() {
  return configured;
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function saveSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = String(subscription?.keys?.p256dh || '');
  const auth = String(subscription?.keys?.auth || '');
  if (!endpoint || !p256dh || !auth) {
    const err = new Error('Invalid push subscription.');
    err.status = 400;
    throw err;
  }
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       updated_at = datetime('now')`
  ).run(userId, endpoint, p256dh, auth);
}

function removeSubscription(userId, endpoint) {
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint));
  } else {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  }
}

function listAdminSubscriptions() {
  return db
    .prepare(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       INNER JOIN users u ON u.id = ps.user_id
       WHERE u.is_admin = 1 AND lower(u.email) = lower(?)`
    )
    .all(require('./db').ADMIN_EMAIL);
}

async function notifyAdminNewSignup(userEmail) {
  if (!configured) return { sent: 0, pruned: 0, skipped: true };
  const rows = listAdminSubscriptions();
  if (!rows.length) return { sent: 0, pruned: 0, skipped: false };

  const payload = JSON.stringify({
    title: 'ShoeLogger',
    body: `New user signed up: ${userEmail}`,
    url: '/?adminNotif=1',
    tag: 'shoelogger-new-user',
  });

  let sent = 0;
  let pruned = 0;
  await Promise.all(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload);
        sent += 1;
      } catch (err) {
        const status = err.statusCode || err.status;
        if (status === 404 || status === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
          pruned += 1;
        } else {
          console.error('Web Push send failed', status || err.message);
        }
      }
    })
  );
  return { sent, pruned, skipped: false };
}

module.exports = {
  configurePushFromEnv,
  isPushConfigured,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  listAdminSubscriptions,
  notifyAdminNewSignup,
  webpush,
};
