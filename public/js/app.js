(() => {
  'use strict';

  const main = document.getElementById('main');
  const headerActions = document.getElementById('header-actions');
  const toastEl = document.getElementById('toast');

  const KM_PER_MI = 1.609344;
  const DEFAULT_MAX_KM = 800;
  const WEAR_AMBER_RATIO = 500 / 800;

  const QUICK_KM = [
    { label: '5K', km: 5 },
    { label: '10K', km: 10 },
    { label: '21.1K', km: 21.1 },
    { label: '42.2K', km: 42.2 },
  ];

  const state = {
    user: null,
    shoes: [],
    view: 'loading', // auth | list | detail | settings | admin | loading
    adminUsers: null,
    adminUnread: 0,
    adminNotifs: null,
    notifOpen: false,
    shoeId: null,
    detail: null,
    authMode: 'login',
    error: '',
  };

  const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text || 'Bad response' }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function distanceUnit() {
    return state.user && state.user.distanceUnit === 'mi' ? 'mi' : 'km';
  }

  function unitLabel() {
    return distanceUnit() === 'mi' ? 'mi' : 'km';
  }

  function unitWord() {
    return distanceUnit() === 'mi' ? 'miles' : 'kilometres';
  }

  function round3(n) {
    return Math.round(Number(n) * 1000) / 1000;
  }

  function fromKm(km) {
    const v = Number(km) || 0;
    return distanceUnit() === 'mi' ? round3(v / KM_PER_MI) : round3(v);
  }

  function toKm(displayValue) {
    const v = Number(displayValue);
    if (!Number.isFinite(v)) return NaN;
    return distanceUnit() === 'mi' ? round3(v * KM_PER_MI) : round3(v);
  }

  /** Sensible display up to 3 decimal places, trim trailing zeros. */
  function formatDist(kmStored) {
    const v = fromKm(kmStored);
    if (Number.isInteger(v)) return String(v);
    return String(round3(v));
  }

  function formatDistWithUnit(kmStored) {
    return `${formatDist(kmStored)} ${unitLabel()}`;
  }

  function shoeMaxKm(shoe) {
    const n = Number(shoe && shoe.maxKm);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_KM;
  }

  function wearThresholdText() {
    const u = unitLabel();
    return `Each shoe has its own max (${formatDist(DEFAULT_MAX_KM)} ${u} default). Amber from ~62.5% of max, red at/over max.`;
  }

  function quickButtons() {
    return QUICK_KM.map((q) => {
      const display = fromKm(q.km);
      const label = distanceUnit() === 'mi'
        ? `${q.label} · ${formatDist(q.km)} ${unitLabel()}`
        : q.label;
      return { label, displayValue: display, km: q.km };
    });
  }


  function bindPasswordToggle(root) {
    root.querySelectorAll('[data-password-toggle]').forEach((btn) => {
      const input = root.querySelector(`#${btn.getAttribute('aria-controls')}`);
      if (!input) return;
      btn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        btn.innerHTML = showing ? EYE_OPEN : EYE_OFF;
      });
    });
  }

  function wearBadge(shoe) {
    if (shoe.wearLevel === 'replace') return `<span class="badge badge-red">${escapeHtml(shoe.wearLabel)}</span>`;
    if (shoe.wearLevel === 'replace-soon') return `<span class="badge badge-amber">${escapeHtml(shoe.wearLabel)}</span>`;
    if (shoe.retired) return `<span class="badge badge-muted">Retired</span>`;
    return '';
  }

  function photoBlock(url, cls) {
    if (url) return `<div class="${cls}"><img src="${escapeHtml(url)}" alt="" /></div>`;
    return `<div class="${cls}"><div class="placeholder">👟</div></div>`;
  }

  function maxRunDisplay() {
    return fromKm(500);
  }

  function surfaceLabel(surface) {
    return surface === 'trail' ? 'Trail' : 'Road';
  }

  function surfaceSelectHtml(id, name, selected) {
    const sel = selected === 'trail' ? 'trail' : 'road';
    return `
      <select id="${id}" name="${name}">
        <option value="road" ${sel === 'road' ? 'selected' : ''}>Road</option>
        <option value="trail" ${sel === 'trail' ? 'selected' : ''}>Trail</option>
      </select>`;
  }


  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function enableAdminPushAlerts() {
    if (!state.user || !state.user.isAdmin) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast('Push alerts are not supported in this browser.');
      return;
    }
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isIOS && !standalone) {
      toast('On iPhone/iPad: Add ShoeLogger to your Home Screen, open it from there, then enable alerts.');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast('Notification permission was not granted.');
        return;
      }
      const keyData = await api('/api/admin/push/vapid-public-key');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }
      await api('/api/admin/push/subscribe', {
        method: 'POST',
        body: { subscription: sub.toJSON() },
      });
      toast('Phone alerts enabled for new signups.');
    } catch (err) {
      toast(err.message || 'Could not enable alerts');
    }
  }

  function formatNotifTime(iso) {
    if (!iso) return '';
    const raw = String(iso).replace(' ', 'T');
    const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    try {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  async function refreshAdminNotifications({ withList = false } = {}) {
    if (!state.user || !state.user.isAdmin) {
      state.adminUnread = 0;
      state.adminNotifs = null;
      return;
    }
    try {
      const countData = await api('/api/admin/notifications/unread-count');
      state.adminUnread = Number(countData.unreadCount) || 0;
      if (withList || state.notifOpen) {
        const listData = await api('/api/admin/notifications');
        state.adminNotifs = listData.notifications || [];
      }
      // Update badge/panel without full re-render if header already present
      const badge = document.getElementById('notif-badge');
      if (badge) {
        if (state.adminUnread > 0) {
          badge.hidden = false;
          badge.textContent = state.adminUnread > 99 ? '99+' : String(state.adminUnread);
        } else {
          badge.hidden = true;
          badge.textContent = '';
        }
      }
      if (state.notifOpen) renderNotifPanel();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        state.adminUnread = 0;
        state.notifOpen = false;
      }
    }
  }

  function renderNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const items = state.adminNotifs;
    if (items == null) {
      panel.innerHTML = `<div class="notif-empty">Loading…</div>`;
      return;
    }
    if (!items.length) {
      panel.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="notif-panel-head">
        <strong>Notifications</strong>
        <div class="notif-panel-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="notif-enable-push">Enable phone alerts</button>
          <button type="button" class="btn btn-ghost btn-sm" id="notif-mark-all">Mark all read</button>
        </div>
      </div>
      <ul class="notif-list">
        ${items.map((n) => `
          <li class="notif-item ${n.read ? 'is-read' : 'is-unread'}" data-id="${n.id}">
            <div class="notif-text">New user signed up: <strong>${escapeHtml(n.userEmail)}</strong></div>
            <div class="notif-meta">${escapeHtml(formatNotifTime(n.createdAt))}</div>
          </li>
        `).join('')}
      </ul>
    `;
    panel.querySelector('#notif-mark-all')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const data = await api('/api/admin/notifications/mark-read', { method: 'POST', body: { all: true } });
        state.adminUnread = Number(data.unreadCount) || 0;
        await refreshAdminNotifications({ withList: true });
        renderHeader();
      } catch (err) {
        toast(err.message);
      }
    });
    panel.querySelector('#notif-enable-push')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await enableAdminPushAlerts();
    });
  }

  function renderHeader() {
    if (!state.user) {
      headerActions.innerHTML = '';
      state.notifOpen = false;
      return;
    }
    const adminBtn = state.user.isAdmin
      ? '<button class="btn btn-ghost btn-sm" type="button" id="btn-admin">Admin</button>'
      : '';
    const notifBtn = state.user.isAdmin ? `
      <div class="notif-wrap" id="notif-wrap">
        <button class="btn btn-ghost btn-sm notif-bell" type="button" id="btn-notif" aria-label="Notifications" aria-expanded="${state.notifOpen ? 'true' : 'false'}">
          <span aria-hidden="true">🔔</span>
          <span class="notif-badge" id="notif-badge" ${state.adminUnread > 0 ? '' : 'hidden'}>${state.adminUnread > 99 ? '99+' : (state.adminUnread || '')}</span>
        </button>
        <div class="notif-panel" id="notif-panel" ${state.notifOpen ? '' : 'hidden'}></div>
      </div>` : '';
    headerActions.innerHTML = `
      <span class="user-chip" title="${escapeHtml(state.user.email)}">${escapeHtml(state.user.email)}</span>
      ${notifBtn}
      ${adminBtn}
      <button class="btn btn-ghost btn-sm" type="button" id="btn-settings">Settings</button>
      <button class="btn btn-ghost btn-sm" type="button" id="btn-logout">Log out</button>
    `;
    if (state.user.isAdmin && state.notifOpen) renderNotifPanel();

    const notifEl = document.getElementById('btn-notif');
    if (notifEl) {
      notifEl.onclick = async (e) => {
        e.stopPropagation();
        state.notifOpen = !state.notifOpen;
        renderHeader();
        if (state.notifOpen) {
          await refreshAdminNotifications({ withList: true });
          renderNotifPanel();
          document.getElementById('notif-panel')?.removeAttribute('hidden');
        }
      };
    }
    const adminEl = document.getElementById('btn-admin');
    if (adminEl) {
      adminEl.onclick = () => {
        state.view = 'admin';
        state.adminUsers = null;
        state.notifOpen = false;
        render();
        loadAdminUsers();
      };
    }
    document.getElementById('btn-settings').onclick = () => {
      state.view = 'settings';
      state.notifOpen = false;
      render();
    };
    document.getElementById('btn-logout').onclick = async () => {
      await api('/api/logout', { method: 'POST', body: {} });
      state.user = null;
      state.shoes = [];
      state.adminUsers = null;
      state.adminUnread = 0;
      state.adminNotifs = null;
      state.notifOpen = false;
      state.view = 'auth';
      render();
    };
  }

  function renderAuth() {
    const isLogin = state.authMode === 'login';
    main.innerHTML = `
      <section class="card auth-wrap">
        <h1>Track every kilometre</h1>
        <p class="lead">Log races and training on each pair. Set a max distance per pair and get a clear replace signal.</p>
        <div class="tabs">
          <button class="tab ${isLogin ? 'active' : ''}" type="button" data-mode="login">Log in</button>
          <button class="tab ${!isLogin ? 'active' : ''}" type="button" data-mode="signup">Sign up</button>
        </div>
        ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ''}
        <form id="auth-form">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="password-wrap">
              <input id="password" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="8" required />
              <button type="button" class="password-toggle" data-password-toggle aria-controls="password" aria-pressed="false" aria-label="Show password">${EYE_OPEN}</button>
            </div>
            ${!isLogin ? '<div class="hint">At least 8 characters.</div>' : ''}
          </div>
          <button class="btn btn-primary" type="submit">${isLogin ? 'Log in' : 'Create free account'}</button>
        </form>
      </section>
    `;
    bindPasswordToggle(main);
    main.querySelectorAll('.tab').forEach((btn) => {
      btn.onclick = () => {
        state.authMode = btn.dataset.mode;
        state.error = '';
        render();
      };
    });
    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      state.error = '';
      const email = e.target.email.value;
      const password = e.target.password.value;
      try {
        const path = isLogin ? '/api/login' : '/api/signup';
        const data = await api(path, { method: 'POST', body: { email, password } });
        state.user = data.user;
        await loadShoes();
        state.view = 'list';
        render();
        toast(isLogin ? 'Welcome back' : 'Account created');
      } catch (err) {
        state.error = err.message;
        render();
      }
    };
  }

  function renderSettings() {
    const unit = distanceUnit();
    main.innerHTML = `
      <button class="back-link" type="button" id="btn-back">← Back</button>
      <section class="card auth-wrap" style="margin-top:0">
        <h1>Settings</h1>
        <p class="lead">Distances are stored in kilometres. Choose how they appear for you.</p>
        <form id="settings-form">
          <fieldset class="unit-fieldset">
            <legend>Default distance unit</legend>
            <label class="unit-option">
              <input type="radio" name="distanceUnit" value="km" ${unit === 'km' ? 'checked' : ''} />
              <span>Kilometres (km)</span>
            </label>
            <label class="unit-option">
              <input type="radio" name="distanceUnit" value="mi" ${unit === 'mi' ? 'checked' : ''} />
              <span>Miles (mi)</span>
            </label>
          </fieldset>
          <p class="hint">Race chips and each shoe's max-distance wear thresholds are shown in your chosen unit. Totals always show the unit label.</p>
          <button class="btn btn-primary" type="submit">Save settings</button>
        </form>
      </section>
    `;
    document.getElementById('btn-back').onclick = () => {
      state.view = 'list';
      render();
    };
    document.getElementById('settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const distanceUnitVal = e.target.distanceUnit.value;
      try {
        const data = await api('/api/settings', { method: 'PATCH', body: { distanceUnit: distanceUnitVal } });
        state.user = data.user;
        toast(`Using ${data.user.distanceUnit === 'mi' ? 'miles' : 'kilometres'}`);
        state.view = 'list';
        render();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  function renderList() {
    const active = state.shoes.filter((s) => !s.retired);
    const retired = state.shoes.filter((s) => s.retired);
    main.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Your shoes</h1>
          <p>Totals include starting mileage. ${wearThresholdText()}</p>
        </div>
        <button class="btn btn-primary" style="width:auto" type="button" id="btn-add-shoe">Add shoe</button>
      </div>
      ${state.shoes.length === 0 ? `
        <div class="card empty">
          <h2>No shoes yet</h2>
          <p>Add your first pair — photo, name, and optional starting ${unitLabel()}.</p>
          <button class="btn btn-primary" style="width:auto;margin-top:1rem" type="button" id="btn-add-shoe-empty">Add shoe</button>
        </div>` : `
        <div class="shoe-grid" id="shoe-grid">
          ${active.map(shoeCardHtml).join('')}
          ${retired.map(shoeCardHtml).join('')}
        </div>`}
    `;
    const openAdd = () => openShoeModal();
    document.getElementById('btn-add-shoe')?.addEventListener('click', openAdd);
    document.getElementById('btn-add-shoe-empty')?.addEventListener('click', openAdd);
    main.querySelectorAll('.shoe-card').forEach((el) => {
      el.onclick = () => openDetail(Number(el.dataset.id));
    });
  }

  function shoeCardHtml(shoe) {
    const u = unitLabel();
    const total = formatDist(shoe.totalKm);
    const cap = formatDist(shoeMaxKm(shoe));
    return `
      <article class="shoe-card ${shoe.retired ? 'retired' : ''}" data-id="${shoe.id}">
        ${photoBlock(shoe.photoUrl, 'shoe-photo')}
        <div class="shoe-body">
          <div class="shoe-top">
            <h2 class="shoe-name">${escapeHtml(shoe.name)}</h2>
            ${wearBadge(shoe)}
          </div>
          <p class="shoe-meta">${escapeHtml(shoe.shoeType)} · ${total} / ${cap} ${u}</p>
          <div class="km-line">
            <span class="km-value">${total} <span class="unit-label">${u}</span>
            <span class="km-cap">${shoe.progressPct}%</span>
          </div>
          <div class="progress" aria-hidden="true"><span class="${shoe.barClass}" style="width:${shoe.progressPct}%"></span></div>
        </div>
      </article>
    `;
  }

  async function openDetail(id) {
    state.view = 'loading';
    render();
    try {
      const data = await api(`/api/shoes/${id}`);
      state.shoeId = id;
      state.detail = data;
      state.view = 'detail';
      render();
    } catch (err) {
      toast(err.message);
      state.view = 'list';
      render();
    }
  }

  function renderDetail() {
    const { shoe, runs } = state.detail;
    const u = unitLabel();
    const cap = formatDist(shoeMaxKm(shoe));
    const quick = quickButtons();
    main.innerHTML = `
      <button class="back-link" type="button" id="btn-back">← All shoes</button>
      <section class="card">
        <div class="detail-hero">
          ${photoBlock(shoe.photoUrl, 'detail-photo')}
          <div>
            <div class="shoe-top">
              <h1 style="margin:0">${escapeHtml(shoe.name)}</h1>
              ${wearBadge(shoe)}
            </div>
            <p class="shoe-meta">${escapeHtml(shoe.shoeType)}${shoe.retired ? ' · retired' : ''}</p>
            <div class="km-line">
              <span class="km-value">${formatDist(shoe.totalKm)} <span class="unit-label">${u}</span></span>
              <span class="km-cap">of ${cap} ${u}</span>
            </div>
            <div class="progress" aria-hidden="true"><span class="${shoe.barClass}" style="width:${shoe.progressPct}%"></span></div>
            <p class="hint" style="margin-top:0.6rem">Starting ${formatDistWithUnit(shoe.startingKm)} + logged ${formatDistWithUnit(shoe.loggedKm)}</p>
            <div class="row" style="margin-top:0.9rem">
              <button class="btn btn-secondary btn-sm" type="button" id="btn-edit-shoe">Edit</button>
              <button class="btn btn-secondary btn-sm" type="button" id="btn-retire">${shoe.retired ? 'Unretire' : 'Retire'}</button>
              <button class="btn btn-danger btn-sm" type="button" id="btn-delete-shoe">Delete</button>
            </div>
          </div>
        </div>
      </section>

      <h2 class="section-title">Log a run</h2>
      <section class="card">
        <div class="quick-row">
          ${quick.map((q) => `<button class="btn btn-chip" type="button" data-display="${q.displayValue}">${escapeHtml(q.label)}</button>`).join('')}
        </div>
        <form id="log-form">
          <div class="row">
            <div class="field">
              <label for="run-shoe">Shoe</label>
              <select id="run-shoe" name="shoeId">
                ${(function () {
                  const list = state.shoes.slice();
                  if (!list.some((s) => s.id === shoe.id)) list.unshift(shoe);
                  return list.filter((s) => !s.retired || s.id === shoe.id).map((s) => `
                  <option value="${s.id}" data-surface="${s.shoeType === 'trail' ? 'trail' : 'road'}" ${s.id === shoe.id ? 'selected' : ''}>${escapeHtml(s.name)}${s.retired ? ' (retired)' : ''}</option>
                `).join('');
                })()}
              </select>
            </div>
            <div class="field">
              <label for="run-surface">Surface</label>
              ${surfaceSelectHtml('run-surface', 'surface', shoe.shoeType)}
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="runDate">Date</label>
              <input id="runDate" name="runDate" type="date" value="${today()}" required />
            </div>
            <div class="field">
              <label for="distance">${escapeHtml(unitWord().replace(/^./, (c) => c.toUpperCase()))} (${u})</label>
              <input id="distance" name="distance" type="number" min="0.001" max="${maxRunDisplay()}" step="0.001" required placeholder="e.g. ${distanceUnit() === 'mi' ? '3.107' : '12.345'}" />
            </div>
          </div>
          <div class="field">
            <label for="note">Note (optional)</label>
            <input id="note" name="note" type="text" maxlength="500" placeholder="Race, route, feel…" />
          </div>
          <button class="btn btn-primary" type="submit">Save run</button>
        </form>
      </section>

      <h2 class="section-title">History</h2>
      ${runs.length === 0 ? `<div class="card empty"><p>No runs logged yet.</p></div>` : `
        <div class="log-list">
          ${runs.map((r) => `
            <div class="log-item" data-run="${r.id}">
              <div>
                <strong>${formatDistWithUnit(r.km)} <span class="surface-pill">${escapeHtml(surfaceLabel(r.surface))}</span></strong>
                <div class="meta">${escapeHtml(r.runDate)} · ${escapeHtml(surfaceLabel(r.surface))}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
              </div>
              <div class="log-actions">
                <button class="btn btn-secondary btn-sm" type="button" data-edit="${r.id}">Edit</button>
                <button class="btn btn-danger btn-sm" type="button" data-del="${r.id}">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>`}
    `;

    document.getElementById('btn-back').onclick = async () => {
      await loadShoes();
      state.view = 'list';
      state.detail = null;
      render();
    };
    document.getElementById('btn-edit-shoe').onclick = () => openShoeModal(shoe);
    document.getElementById('btn-retire').onclick = async () => {
      const fd = new FormData();
      fd.append('retired', shoe.retired ? 'false' : 'true');
      const data = await api(`/api/shoes/${shoe.id}`, { method: 'PATCH', body: fd });
      state.detail.shoe = data.shoe;
      toast(data.shoe.retired ? 'Shoe retired' : 'Shoe unretired');
      render();
    };
    document.getElementById('btn-delete-shoe').onclick = async () => {
      if (!confirm(`Delete “${shoe.name}” and all its runs?`)) return;
      await api(`/api/shoes/${shoe.id}`, { method: 'DELETE' });
      await loadShoes();
      state.view = 'list';
      state.detail = null;
      toast('Shoe deleted');
      render();
    };

    main.querySelectorAll('[data-display]').forEach((btn) => {
      btn.onclick = () => { document.getElementById('distance').value = btn.dataset.display; };
    });

    const shoeSelect = document.getElementById('run-shoe');
    const surfaceSelect = document.getElementById('run-surface');
    let surfaceTouched = false;
    surfaceSelect.addEventListener('change', () => { surfaceTouched = true; });
    shoeSelect.addEventListener('change', () => {
      const opt = shoeSelect.selectedOptions[0];
      const nextSurface = opt?.dataset.surface === 'trail' ? 'trail' : 'road';
      if (!surfaceTouched) surfaceSelect.value = nextSurface;
    });

    document.getElementById('log-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const selectedShoeId = Number(e.target.shoeId.value);
        const km = toKm(e.target.distance.value);
        const body = {
          runDate: e.target.runDate.value,
          km,
          surface: e.target.surface.value,
          note: e.target.note.value,
        };
        const data = await api(`/api/shoes/${selectedShoeId}/runs`, { method: 'POST', body });
        if (selectedShoeId === shoe.id) {
          state.detail.shoe = data.shoe;
          state.detail.runs = [data.run, ...state.detail.runs];
          toast(`Logged ${formatDistWithUnit(data.run.km)}`);
          render();
        } else {
          toast(`Logged ${formatDistWithUnit(data.run.km)} on ${data.shoe.name}`);
          await openDetail(selectedShoeId);
        }
      } catch (err) {
        toast(err.message);
      }
    };

    main.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => {
        const run = runs.find((r) => r.id === Number(btn.dataset.edit));
        if (run) openEditRunModal(run);
      };
    });
    main.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Delete this run?')) return;
        try {
          const data = await api(`/api/runs/${btn.dataset.del}`, { method: 'DELETE' });
          state.detail.shoe = data.shoe;
          state.detail.runs = state.detail.runs.filter((r) => r.id !== Number(btn.dataset.del));
          toast('Run deleted');
          render();
        } catch (err) {
          toast(err.message);
        }
      };
    });
  }

  function openShoeModal(shoe = null) {
    const editing = !!shoe;
    const u = unitLabel();
    const startingDisplay = shoe ? fromKm(shoe.startingKm) : 0;
    const maxDisplay = shoe ? fromKm(shoeMaxKm(shoe)) : fromKm(DEFAULT_MAX_KM);
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${editing ? 'Edit shoe' : 'Add shoe'}</h2>
        <form id="shoe-form">
          <div class="field">
            <label for="shoe-name">Name</label>
            <input id="shoe-name" name="name" required maxlength="80" value="${escapeHtml(shoe?.name || '')}" placeholder="Anthem 8" />
          </div>
          <div class="row">
            <div class="field">
              <label for="shoe-type">Surface</label>
              <select id="shoe-type" name="shoeType">
                <option value="road" ${!shoe || shoe.shoeType === 'road' ? 'selected' : ''}>Road</option>
                <option value="trail" ${shoe?.shoeType === 'trail' ? 'selected' : ''}>Trail</option>
              </select>
            </div>
            <div class="field">
              <label for="starting-distance">Starting ${u}</label>
              <input id="starting-distance" type="number" min="0" step="0.001" value="${startingDisplay}" />
            </div>
          </div>
          <div class="field">
            <label for="max-distance">Max ${u} before replace</label>
            <input id="max-distance" type="number" min="0.001" step="0.001" required value="${maxDisplay}" />
            <div class="hint">Amber from ~62.5% of this max. Default ${formatDist(DEFAULT_MAX_KM)} ${u}.</div>
          </div>
          <div class="field photo-field">
            <span class="field-label" id="photo-legend">Photo</span>
            <div class="photo-picker">
              <input id="photo" name="photo" type="file" accept="image/*" class="photo-input" />
              <label class="btn btn-secondary photo-btn" for="photo" id="photo-btn-label">${shoe?.photoUrl ? 'Change photo' : 'Add photo'}</label>
              <button type="button" class="btn btn-ghost btn-sm" id="photo-clear" ${shoe?.photoUrl ? '' : 'hidden'}>Remove</button>
            </div>
            <div class="hint">One control — on phone you can Take Photo, pick from library, or choose a file. JPG, PNG or WebP · max 5 MB</div>
            <img id="photo-preview" class="photo-preview" ${shoe?.photoUrl ? `src="${escapeHtml(shoe.photoUrl)}"` : 'hidden'} alt="" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" type="button" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" type="submit">${editing ? 'Save' : 'Add shoe'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#modal-cancel').onclick = close;
    const photoInput = backdrop.querySelector('#photo');
    const preview = backdrop.querySelector('#photo-preview');
    const photoLabel = backdrop.querySelector('#photo-btn-label');
    const clearBtn = backdrop.querySelector('#photo-clear');
    const existingUrl = shoe?.photoUrl || null;
    let objectUrl = null;

    function setPreview(url, { isObjectUrl = false } = {}) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (!url) {
        preview.removeAttribute('src');
        preview.hidden = true;
        photoLabel.textContent = 'Add photo';
        clearBtn.hidden = true;
        return;
      }
      if (isObjectUrl) objectUrl = url;
      preview.src = url;
      preview.hidden = false;
      photoLabel.textContent = 'Change photo';
      clearBtn.hidden = false;
    }

    photoInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setPreview(URL.createObjectURL(file), { isObjectUrl: true });
    };
    clearBtn.onclick = () => {
      photoInput.value = '';
      if (existingUrl) setPreview(existingUrl);
      else setPreview(null);
    };

    backdrop.querySelector('#shoe-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('name', e.target.name.value);
      fd.append('shoeType', e.target.shoeType.value);
      const startKm = toKm(backdrop.querySelector('#starting-distance').value || 0);
      const maxKm = toKm(backdrop.querySelector('#max-distance').value);
      if (!(maxKm > 0)) {
        toast(`Max ${u} must be greater than zero.`);
        return;
      }
      fd.append('startingKm', String(startKm));
      fd.append('maxKm', String(maxKm));
      if (photoInput.files?.[0]) fd.append('photo', photoInput.files[0]);
      try {
        if (editing) {
          const data = await api(`/api/shoes/${shoe.id}`, { method: 'PATCH', body: fd });
          if (state.view === 'detail' && state.detail) state.detail.shoe = data.shoe;
          await loadShoes();
          toast('Shoe updated');
        } else {
          await api('/api/shoes', { method: 'POST', body: fd });
          await loadShoes();
          toast('Shoe added');
        }
        close();
        render();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  function openEditRunModal(run) {
    const u = unitLabel();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Edit run</h2>
        <form id="edit-run-form">
          <div class="field">
            <label for="edit-date">Date</label>
            <input id="edit-date" name="runDate" type="date" value="${escapeHtml(run.runDate)}" required />
          </div>
          <div class="row">
            <div class="field">
              <label for="edit-distance">${escapeHtml(unitWord().replace(/^./, (c) => c.toUpperCase()))} (${u})</label>
              <input id="edit-distance" name="distance" type="number" min="0.001" max="${maxRunDisplay()}" step="0.001" value="${fromKm(run.km)}" required />
            </div>
            <div class="field">
              <label for="edit-surface">Surface</label>
              ${surfaceSelectHtml('edit-surface', 'surface', run.surface)}
            </div>
          </div>
          <div class="field">
            <label for="edit-note">Note</label>
            <input id="edit-note" name="note" type="text" maxlength="500" value="${escapeHtml(run.note || '')}" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" type="button" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#modal-cancel').onclick = close;
    backdrop.querySelector('#edit-run-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = {
          runDate: e.target.runDate.value,
          km: toKm(e.target.distance.value),
          surface: e.target.surface.value,
          note: e.target.note.value,
        };
        const data = await api(`/api/runs/${run.id}`, { method: 'PATCH', body });
        state.detail.shoe = data.shoe;
        state.detail.runs = state.detail.runs.map((r) => (r.id === run.id ? data.run : r));
        toast('Run updated');
        close();
        render();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  function formatSignupDate(iso) {
    if (!iso) return '—';
    const d = String(iso).slice(0, 10);
    return d || '—';
  }

  async function loadAdminUsers() {
    if (!state.user || !state.user.isAdmin) {
      state.adminUsers = null;
      return;
    }
    try {
      const data = await api('/api/admin/users');
      state.adminUsers = data.users || [];
      if (state.view === 'admin') render();
    } catch (err) {
      state.adminUsers = null;
      toast(err.message || 'Admin load failed');
      if (err.status === 403 || err.status === 401) {
        state.view = 'list';
        render();
      }
    }
  }

  function renderAdmin() {
    if (!state.user || !state.user.isAdmin) {
      state.view = 'list';
      return renderList();
    }
    const rows = state.adminUsers;
    const body = rows == null
      ? `<div class="card empty"><p>Loading users…</p></div>`
      : rows.length === 0
        ? `<div class="card empty"><p>No users yet.</p></div>`
        : `
      <div class="card admin-card">
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Signed up</th>
                <th>Shoes</th>
                <th>Runs</th>
                <th>Total km</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((u) => `
                <tr>
                  <td class="admin-email">${escapeHtml(u.email)}</td>
                  <td>${u.name ? escapeHtml(u.name) : '—'}</td>
                  <td>${escapeHtml(formatSignupDate(u.createdAt))}</td>
                  <td>${Number(u.shoeCount) || 0}</td>
                  <td>${Number(u.runCount) || 0}</td>
                  <td>${escapeHtml(String(round3(u.totalKm || 0)))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint admin-hint">${rows.length} user${rows.length === 1 ? '' : 's'}</p>
      </div>`;
    main.innerHTML = `
      <button class="back-link" type="button" id="btn-back">← All shoes</button>
      <section class="admin-wrap">
        <h1 class="page-title">Admin</h1>
        <p class="lead">All registered users (server-gated).</p>
        ${body}
      </section>
    `;
    document.getElementById('btn-back').onclick = () => {
      state.view = 'list';
      render();
    };
  }

  function renderLoading() {
    main.innerHTML = `<div class="card empty"><p>Loading…</p></div>`;
  }

  function render() {
    renderHeader();
    if (state.view === 'loading') return renderLoading();
    if (state.view === 'auth') return renderAuth();
    if (state.view === 'settings') return renderSettings();
    if (state.view === 'admin') return renderAdmin();
    if (state.view === 'detail') return renderDetail();
    return renderList();
  }

  async function loadShoes() {
    const data = await api('/api/shoes');
    state.shoes = data.shoes;
  }

  async function boot() {
    try {
      const me = await api('/api/me');
      state.user = me.user;
      if (state.user) {
        await loadShoes();
        state.view = 'list';
        if (state.user.isAdmin) await refreshAdminNotifications();
      } else {
        state.view = 'auth';
      }
    } catch {
      state.view = 'auth';
    }
    render();
    if (state.user && state.user.isAdmin) {
      const params = new URLSearchParams(location.search);
      if (params.get('adminNotif') === '1') {
        state.notifOpen = true;
        renderHeader();
        refreshAdminNotifications({ withList: true }).then(() => renderNotifPanel());
        params.delete('adminNotif');
        const next = params.toString();
        history.replaceState({}, '', location.pathname + (next ? `?${next}` : '') + location.hash);
      }
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'open-admin-notifications') return;
      if (!state.user || !state.user.isAdmin) return;
      state.notifOpen = true;
      renderHeader();
      refreshAdminNotifications({ withList: true }).then(() => renderNotifPanel());
    });
  }

  document.addEventListener('click', (e) => {
    if (!state.notifOpen) return;
    const wrap = document.getElementById('notif-wrap');
    if (wrap && !wrap.contains(e.target)) {
      state.notifOpen = false;
      const panel = document.getElementById('notif-panel');
      if (panel) panel.hidden = true;
      const btn = document.getElementById('btn-notif');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });

  window.addEventListener('focus', () => {
    if (state.user && state.user.isAdmin) refreshAdminNotifications({ withList: state.notifOpen });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user && state.user.isAdmin) {
      refreshAdminNotifications({ withList: state.notifOpen });
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js?v=v13').catch(() => {});
    });
  }

  boot();
})();
