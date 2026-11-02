# ShoeLogger

Progressive Web App for tracking kilometres on running shoes. Install it on your phone or computer, add a photo and name for each pair, log races and training, and get clear wear warnings from 500 km (amber / replace soon) to 800 km (red / replace).

Public URL (once routed): **https://shoelogger.streblainnovations.com**

## Features

- Free email + password sign-up and login (bcrypt hashed, rate-limited)
- Per-user shoes: name, photo, road/trail, optional starting km, retire
- Log runs with date, km, optional note; quick buttons for 5K / 10K / 21.1K / 42.2K
- Edit or delete runs; shoe cards show total km and an 800 km progress bar
- Installable PWA (manifest + service worker + icons)
- Single Node/Express process serves API and static frontend; SQLite (`better-sqlite3`)

## Stack

- Node.js + Express
- `better-sqlite3` → `data/app.db` (gitignored)
- `bcryptjs` + `cookie-session` (secret from `.env`)
- `multer` + `sharp` for shoe photos under `data/uploads/` (images only, ≤ 5 MB, resized)

## Local development

```bash
cp .env.example .env
# set SESSION_SECRET to a long random string
npm ci
npm start
# http://127.0.0.1:8096
```

For local HTTP smoke tests set `NODE_ENV=development` (or omit `COOKIE_SECURE`) so the session cookie is not marked Secure.

## Raspberry Pi deploy

Matches the Garden Route Events pattern: own folder under `~/Desktop/Projects`, own systemd unit, own port. **Do not** touch other apps, Docker, Caddy, cloudflared, or nginx yourself — ask Christopher to add the Cloudflare/Caddy route.

### 1. Clone and install

```bash
mkdir -p "/home/admin/Desktop/Projects/ShoeLogger Server"
cd "/home/admin/Desktop/Projects/ShoeLogger Server"
git clone https://github.com/christopherAlberts/shoe-logger.git .
npm ci
```

### 2. Environment

```bash
cp .env.example .env
chmod 600 .env
# Edit .env:
# PORT=8096
# SESSION_SECRET=<long-random-string>
# NODE_ENV=production
# COOKIE_SECURE=true
```

Confirm the port is free first:

```bash
ss -ltnp | grep 8096 || echo "8096 free"
```

### 3. systemd

```bash
sudo cp deploy/shoelogger.service /etc/systemd/system/shoelogger.service
sudo systemctl daemon-reload
sudo systemctl enable --now shoelogger.service
sudo systemctl status shoelogger.service
```

Restart only this service after pulls:

```bash
cd "/home/admin/Desktop/Projects/ShoeLogger Server"
git pull
npm ci
sudo systemctl restart shoelogger.service
```

Back up `data/app.db` before schema changes.

### 4. Public hostname

Ask Christopher to point **shoelogger.streblainnovations.com** at **localhost:8096** in Cloudflare + Caddy (same pattern as `gardenrouteevents.streblainnovations.com` → 8095). Do not edit Caddy/cloudflared/nginx from deploy scripts.

### 5. Hourly git pull (optional)

If the Pi already pulls other repos hourly, add this repo the same way — or pull manually as above. Commit author for this project: `Christopher Alberts <christopherAlberts@users.noreply.github.com>`.

## API overview

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/signup` | `{ email, password }` |
| POST | `/api/login` | `{ email, password }` |
| POST | `/api/logout` | |
| GET | `/api/me` | current user or `null` |
| GET/POST | `/api/shoes` | list / create (multipart for photo) |
| GET/PATCH/DELETE | `/api/shoes/:id` | |
| POST | `/api/shoes/:id/runs` | `{ runDate, km, note? }` |
| PATCH/DELETE | `/api/runs/:id` | |

All shoe/run data is scoped to the logged-in user.

## License

MIT
