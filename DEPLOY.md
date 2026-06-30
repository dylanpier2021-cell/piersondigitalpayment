# Deploying Transfado

## Why sign-in is broken right now

Transfado is a **full-stack app**, not a static site. Login, accounts, sessions, payments, and the database all live in the Node/Express server (`server/index.js`). That one server **also serves the UI** (it serves `public/` *and* `/auth`, `/api`, `/v1` from the same origin).

The current transfado.com is hosting only the static `public/` folder with **no backend**, so every API call — including `POST /auth/login` — hits nothing and fails. Plain static hosting (e.g. a static Vercel/Netlify deploy) **cannot run this app.**

**The fix:** deploy the whole Node app to a host that runs a long-lived Node process — **Render, Railway, Fly.io, or a VPS** — and point transfado.com at it. Because the UI and API are the same server, there is **no separate "frontend → backend" wiring** to do: deploy once, and everything works at that URL.

✅ **Verify after deploy:** open `https://<your-app>/api/health` — it must return `{"ok":true,...}` JSON. If it does, login works.

---

## Option A — Render (recommended, free, ~3 minutes)

This repo ships a **`render.yaml` Blueprint**, so Render configures itself.

1. Push this repo to GitHub (already connected). *Tip: rename the GitHub repo to `transfado` for a clean URL.*
2. Go to **dashboard.render.com → New + → Blueprint**.
3. Connect the repo. Render reads `render.yaml` and creates a **Web Service** (build `npm ci --omit=dev`, start `node server/index.js`, health check `/api/health`). It auto-generates `SESSION_SECRET`.
4. Click **Apply**. Wait for the deploy to go green.
5. Visit `https://transfado.onrender.com/api/health` → JSON. Then `/login` → sign in with `owner@transfado.com` / `transfado123`.
6. **Custom domain:** Service → **Settings → Custom Domains → add `transfado.com`**, then add the CNAME/A record Render shows at your DNS registrar.

> Free Render services sleep after ~15 min idle and re-seed demo data on wake (login still works). For a **persistent** database, switch the plan to *Starter*, uncomment the `disk:` block + `TF_DATA_DIR=/var/data` in `render.yaml`, and redeploy. (Long-term, migrate the JSON store to Postgres — see COMPLIANCE.md.)

---

## Option B — Railway

1. **railway.com → New Project → Deploy from GitHub repo.**
2. Railway detects the `Dockerfile` (or the `Procfile`) and builds. No config needed.
3. Add variables: `SESSION_SECRET` (any long random string), `ADMIN_EMAIL=owner@transfado.com`, `ADMIN_PASSWORD=transfado123`.
4. Generate a domain (Settings → Networking) and verify `/api/health`. Add `transfado.com` as a custom domain.
5. For persistence: add a **Volume** mounted at `/data` and set `TF_DATA_DIR=/data`.

## Option C — Fly.io

```bash
fly launch --copy-config --now   # uses the included fly.toml + Dockerfile
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD=transfado123
fly deploy
fly open                          # then /api/health
```
Persistence: `fly volumes create transfado_data --size 1`, then uncomment the `[mounts]` block in `fly.toml`.

## Option D — Any VPS (DigitalOcean / Hetzner / EC2)

```bash
git clone <your-repo-url> transfado
cd transfado && npm ci --omit=dev
# set env: PORT=4242, SESSION_SECRET=..., ADMIN_PASSWORD=...
npx pm2 start server/index.js --name transfado   # or a systemd unit
```
Put **nginx** in front to terminate TLS for `transfado.com` and `proxy_pass` to `http://127.0.0.1:4242`. The JSON DB persists on the VPS disk automatically.

---

## Production checklist

- [ ] `GET /api/health` returns JSON on the production domain.
- [ ] Set a strong **`SESSION_SECRET`** (Render's Blueprint does this automatically).
- [ ] Change **`ADMIN_PASSWORD`** from the demo value.
- [ ] Serve over **HTTPS** (all the hosts above do this automatically).
- [ ] For data that must survive restarts, attach a **persistent disk/volume** and set `TF_DATA_DIR`, or migrate to a managed database.
- [ ] Still **sandbox mode** — no real cards are charged. See [COMPLIANCE.md](COMPLIANCE.md) before handling real money.

The app reads `PORT`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `TF_DATA_DIR` from the environment (see `.env.example`). It binds `0.0.0.0` and seeds demo data automatically on first boot.
