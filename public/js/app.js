(() => {
  'use strict';

  const main = document.getElementById('main');
  const headerActions = document.getElementById('header-actions');
  const toastEl = document.getElementById('toast');

  const KM_PER_MI = 1.609344;
  const WEAR_AMBER_KM = 500;
  const WEAR_RED_KM = 800;

  const QUICK_KM = [
    { label: '5K', km: 5 },
    { label: '10K', km: 10 },
    { label: '21.1K', km: 21.1 },
    { label: '42.2K', km: 42.2 },
  ];

  const state = {
    user: null,
    shoes: [],
    view: 'loading', // auth | list | detail | settings | loading
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

  function wearCapKm() {
    return WEAR_RED_KM;
  }

  function wearThresholdText() {
    const amber = formatDist(WEAR_AMBER_KM);
    const red = formatDist(WEAR_RED_KM);
    const u = unitLabel();
    return `Amber at ${amber} ${u}, red at ${red} ${u}.`;
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

  function isMobileCameraDevice() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua);
    return !!(coarse && mobileUa);
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

  function renderHeader() {
    if (!state.user) {
      headerActions.innerHTML = '';
      return;
    }
    headerActions.innerHTML = `
      <span class="user-chip" title="${escapeHtml(state.user.email)}">${escapeHtml(state.user.email)}</span>
      <button class="btn btn-ghost btn-sm" type="button" id="btn-settings">Settings</button>
      <button class="btn btn-ghost btn-sm" type="button" id="btn-logout">Log out</button>
    `;
    document.getElementById('btn-settings').onclick = () => {
      state.view = 'settings';
      render();
    };
    document.getElementById('btn-logout').onclick = async () => {
      await api('/api/logout', { method: 'POST', body: {} });
      state.user = null;
      state.shoes = [];
      state.view = 'auth';
      render();
    };
  }

  function renderAuth() {
    const isLogin = state.authMode === 'login';
    main.innerHTML = `
      <section class="card auth-wrap">
        <h1>Track every kilometre</h1>
        <p class="lead">Log races and training on each pair. Get a clear signal when shoes hit 500–800 km.</p>
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
          <p class="hint">Race chips and the 500 / 800 km wear thresholds are shown in your chosen unit. Totals always show the unit label.</p>
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
    const cap = formatDist(wearCapKm());
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
    const cap = formatDist(wearCapKm());
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
            <span class="km-value">${total} <span class="unit-label">${u}</span></span>
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
    const cap = formatDist(wearCapKm());
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
                <strong>${formatDistWithUnit(r.km)}</strong>
                <div class="meta">${escapeHtml(r.runDate)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
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

    document.getElementById('log-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const km = toKm(e.target.distance.value);
        const body = {
          runDate: e.target.runDate.value,
          km,
          note: e.target.note.value,
        };
        const data = await api(`/api/shoes/${shoe.id}/runs`, { method: 'POST', body });
        state.detail.shoe = data.shoe;
        state.detail.runs = [data.run, ...state.detail.runs];
        toast(`Logged ${formatDistWithUnit(data.run.km)}`);
        render();
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
              <label for="shoe-type">Type</label>
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
            <span class="field-label" id="photo-legend">Photo ${editing ? '(optional new photo)' : ''}</span>
            <div class="photo-actions" role="group" aria-labelledby="photo-legend">
              <div class="photo-option">
                <label class="file-label" for="photo">Upload photo</label>
                <input id="photo" name="photo" type="file" accept="image/*" />
              </div>
              <div class="photo-option photo-option-camera" id="photo-camera-wrap" hidden>
                <label class="file-label" for="photo-camera">Take photo</label>
                <input id="photo-camera" type="file" accept="image/*" capture="environment" />
              </div>
            </div>
            <div class="hint">JPG, PNG or WebP · max 5 MB</div>
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
    const cameraWrap = backdrop.querySelector('#photo-camera-wrap');
    const photoInput = backdrop.querySelector('#photo');
    const cameraInput = backdrop.querySelector('#photo-camera');
    const preview = backdrop.querySelector('#photo-preview');
    if (isMobileCameraDevice()) {
      cameraWrap.hidden = false;
    }
    function showPhotoPreview(file) {
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    }
    photoInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (cameraInput) cameraInput.value = '';
      showPhotoPreview(file);
    };
    cameraInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      photoInput.files = dt.files;
      cameraInput.value = '';
      showPhotoPreview(file);
    };
    backdrop.querySelector('#shoe-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('name', e.target.name.value);
      fd.append('shoeType', e.target.shoeType.value);
      const startKm = toKm(backdrop.querySelector('#starting-distance').value || 0);
      fd.append('startingKm', String(startKm));
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
          <div class="field">
            <label for="edit-distance">${escapeHtml(unitWord().replace(/^./, (c) => c.toUpperCase()))} (${u})</label>
            <input id="edit-distance" name="distance" type="number" min="0.001" max="${maxRunDisplay()}" step="0.001" value="${fromKm(run.km)}" required />
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

  function renderLoading() {
    main.innerHTML = `<div class="card empty"><p>Loading…</p></div>`;
  }

  function render() {
    renderHeader();
    if (state.view === 'loading') return renderLoading();
    if (state.view === 'auth') return renderAuth();
    if (state.view === 'settings') return renderSettings();
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
      } else {
        state.view = 'auth';
      }
    } catch {
      state.view = 'auth';
    }
    render();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js?v=v6').catch(() => {});
    });
  }

  boot();
})();
