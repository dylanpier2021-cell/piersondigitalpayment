# Transfado

**The new way to get paid.** A payment platform where **you are the processor** — you set your own cost basis and what each client pays, and the platform computes your margin on every transaction.

It does what the big processors do — card payments, hosted checkout, **payment links**, **subscriptions with MRR**, payouts, **coupons/fee-waivers**, webhooks, and a developer API — at **the lowest flat rate of any major processor** (2.5% + $0.10, no monthly fee), and *you* own the fee schedule for yourself and the clients you onboard.

---

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:4242**. The database auto-seeds on first run with rich demo data (5 clients, ~230 transactions, subscriptions, payment links, coupons, webhooks, notifications, payouts).

### Logins

| Role | Email | Password |
|------|-------|----------|
| **Processor (you)** | `owner@transfado.com` | `transfado123` |
| Client | `boochies@example.com` | `demo1234` |

Five demo clients: `boochies@`, `aricka@`, `jermaine@`, `gloss@` (fees waived via `FREE`), `mad@` — all `@example.com` / `demo1234`. Or create a client at **/signup**.

```bash
npm run seed     # wipe + reseed demo data
npm test         # run the full suite (api + coupons + DOM render) on an isolated port
```

---

## Deploy (make login work in production)

Transfado is **full-stack** — the same Node server serves the UI *and* the API/auth/database from one origin. **Static hosting can't run it** (login will fail). Deploy the Node app to **Render, Railway, Fly.io, or a VPS** and point your domain at it. Ships with `render.yaml` (one-click Blueprint), `Dockerfile`, `Procfile`, and `fly.toml`.

Fastest path — **Render**: dashboard.render.com → New + → **Blueprint** → connect this repo → **Apply**. Then verify `https://<app>/api/health` returns JSON and sign in with `owner@transfado.com` / `transfado123`. Full step-by-step (Render / Railway / Fly / VPS, custom domain, persistence) in **[DEPLOY.md](DEPLOY.md)**.

---

## What's new in 2.0

- 🎨 **Full Transfado rebrand** + a premium design system, **light / dark themes** (toggle in the top bar & Settings, remembers your choice), animated **aurora** backgrounds, film-grain, glassmorphism, **count-up** numbers, draw-on charts, skeleton shimmer, **⌘K command palette**, and a spring-confetti success on checkout.
- 🌍 **Internationalization** — English, Spanish, French, German, Portuguese, live-switchable and persisted; numbers/dates/currency localized via `Intl`. Hosted checkout honors `?lang=`. Add a language by dropping one JSON file in `public/locales/`.
- 💸 **Pricing hook** — a home-page comparison that shows Transfado beating every major flat-rate processor, plus an **interactive savings calculator** (enter your volume → see what you save vs Stripe/PayPal/Square).
- 🏷️ **Coupons / fee-waivers** — discount or **fully waive** fees (`FREE` = 0% + $0). Apply per-client (admin), redeemed by a merchant, or entered at checkout. The fee engine, balances, MRR, and profit all stay correct when fees are zeroed.
- 🔌 **Processor-parity features**: webhooks (signed events + delivery log + test-send), in-app notifications + simulated receipts, transaction **search/filter**, **CSV export**, **QR codes** on payment links, and a payout method (debit card / bank) per merchant.
- 📲 **PWA** (installable, offline fallback), favicon, OG/social image, and a service worker.

---

## Core features

**For you (the processor) — `/admin`**
Platform overview (volume, **your revenue**, **your profit**, processing cost, profit MRR, platform MRR), clients with their plan/margin/volume, fee-plan management, **per-client fee overrides + coupons**, suspend/reactivate, a coupon manager, all transactions, and a recurring-billing runner.

**For your clients — `/dashboard`**
Overview with balance/MRR/volume/fees + chart, a **virtual terminal** with live fee preview, transactions (search, filter, CSV), one-click refunds, **payment links** (one-time or recurring, with QR), **subscriptions**, **payouts** to a saved debit card or bank, **webhooks**, **notifications**, coupon redemption, API keys, and settings (incl. theme + language).

**Hosted checkout — `/pay/:linkId`** — branded, aurora, optional discount code, confetti on success, `?lang=` aware.

---

## The fee model

Every fee plan carries **two** rate pairs:

```
cost  = costPct  + costFixed    →  what processing costs you  (~1.8% + $0.08 default)
price = pricePct + priceFixed   →  what the client is charged  (2.5% + $0.10 public rate)
```

Per charge: `merchantFee` (charged to the client) − `processorCost` (your cost) = **your margin**; `merchantNet = amount − merchantFee` goes to the client. A `FREE` coupon sets fee, cost, and margin to 0, so the client keeps 100%.

---

## Developer API

Stripe-style REST under `/v1`, Bearer secret key, integer **cents**. Full reference at **/docs**.

```bash
curl http://localhost:4242/v1/charges \
  -H "Authorization: Bearer sk_sandbox_xxx" -H "Content-Type: application/json" \
  -d '{"amount":2500,"card":{"number":"4242424242424242","exp_month":12,"exp_year":2030,"cvc":"123"}}'
```

`POST/GET /v1/charges`, `POST /v1/refunds`, `POST/GET /v1/subscriptions`, `POST/GET /v1/payment_links`, `GET /v1/balance`, `GET /v1/account`. Test cards: `4242…` approves, `4000 0000 0000 0002` declines (any future expiry, any CVC).

---

## Architecture

```
server/   index.js · config · db (JSON store) · auth · fees (coupon-aware engine) ·
          cards (simulated network) · charges · billing (subs/MRR) · coupons ·
          webhooks · notifications · merchants · links · metrics · seed · routes/
public/   css/app.css (design tokens + themes) · js/common.js (i18n, theme, charts,
          palette, confetti, count-up) · js/dashboard.js · js/admin.js ·
          locales/{en,es,fr,de,pt}.json · *.html · legal/ · favicon/icon/manifest/sw
tests/    run.js (isolated port+DB) · api.test · coupon.test · render.test
```

**Stack:** Node + Express + a file-backed JSON datastore. Three runtime deps (`express`, `bcryptjs`, `cookie-parser`) — no native builds, no build step. Vanilla-JS frontend with CDN libs (qrcode) loaded on demand.

---

## Legal & going live

Legal pages at **/legal** (Terms, Privacy, Acceptable Use) and a gap analysis in **[COMPLIANCE.md](COMPLIANCE.md)**. Transfado ships in **sandbox mode** — no real cards are charged, no real funds move. Going live requires connecting a real acquirer/processor (swap `server/cards.js`), real payout rails, PCI tokenization, KYC/AML, and a sponsoring bank/PayFac — business/legal steps documented in COMPLIANCE.md. **The legal docs are templates, not legal advice — have an attorney review before any real use.**
