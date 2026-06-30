# Changelog

## 2.0.1 — Standalone + deploy-ready

- **Removed every owner/personal reference** — Transfado now stands alone. Scrubbed all locales (es/fr/de/pt eyebrow + footer → neutral tagline + "© 2026 Transfado"), legal pages (operating entity → Transfado; contacts → `legal@`/`privacy@`/`abuse@transfado.com`), the login demo box, manifest, docs, console banner, package metadata, and every code comment. New admin login: **`owner@transfado.com` / `transfado123`**. A repo-wide search for the old brand/owner name now returns nothing outside internal profit/margin field names (never shown to users).
- **Deployment configs** so the backend can run on a real host (login needs the server — static hosting can't run it): `render.yaml` (one-click Blueprint), `Dockerfile` + `.dockerignore`, `Procfile`, `fly.toml`, and a step-by-step **[DEPLOY.md](DEPLOY.md)** (Render / Railway / Fly / VPS, custom domain, persistence). The Node server serves UI + API from one origin, so deploying it makes sign-in work.
- Tests still green (71/71) with the new credentials.

## 2.0.0 — Transfado

Transfado 2.0 ("the new way to get paid") plus a design-system overhaul and a wave of real-processor features.

### Brand & design
- Renamed everywhere (titles, nav, footers, console banner, `platformName`, statement-descriptor default, package name); internal profit/margin field names left untouched so nothing breaks.
- New geometric **T** wordmark/brand-mark with a transfer glyph; favicon, app icon, OG/social image, PWA manifest.
- Rebuilt `app.css` as a token-driven design system: **light + dark themes** (OS default, user override, persisted), 4/8px spacing rhythm, Inter + Space Grotesk type.
- Premium motion: animated **aurora**/mesh backgrounds, film-grain overlay, glassmorphism top bar, **count-up** stats, draw-on charts, **skeleton shimmer**, hover lift/glow, focus rings, page/stagger transitions, **⌘K command palette**, spring **confetti** on successful checkout. Respects `prefers-reduced-motion`.

### Internationalization
- Full i18n runtime with **English, Spanish, French, German, Portuguese**; live language switcher (top bar + Settings), persisted; `Intl`-localized numbers, currency, dates. Hosted checkout honors `?lang=`. Adding a language = one JSON file in `public/locales/`.

### Pricing hook
- Home-page **comparison** (animated bars) showing Transfado as the cheapest flat-rate processor, an **interactive savings calculator** (volume + avg ticket → savings vs Stripe/PayPal/Square), and a published-rates disclaimer.
- Public flat rate set to **2.5% + $0.10, no monthly fee**; seed cost basis ~1.8% + $0.08 so margin stays positive.

### Coupons / fee-waivers
- New `coupons` model + service + admin CRUD; fee engine is coupon-aware. `FREE` waives all fees (fee/cost/margin = 0 → client keeps 100%). Apply per-client (admin), redeem as a merchant, or enter at checkout. Balances, payouts, MRR, and profit stay correct when fees are zeroed. Seeded `FREE`, `LAUNCH50` (50% off), `SAVE10` ($0.10 off).

### Processor-parity features
- **Webhooks**: endpoints with signing secrets, signed delivery log, test-send.
- **Notifications** + simulated email receipts (payment received, payout sent, subscription renewed/failed).
- **CSV export** + transaction **search/filter** (text, status, source, date).
- **QR codes** on payment links; **payout method** (debit card or bank) per merchant.
- **PWA**: installable + offline fallback service worker.

### Quality
- In-repo **test suite** (`npm test`, isolated port + DB): API contract, coupon/fee-waiver, and jsdom render tests (incl. theme persistence + locale swap) — **71 checks, all green**.
- Verified visually across dark/light and desktop/mobile; zero console errors on every page.

### Fixes carried over
- Payout-method feature (debit card / bank) replaces the hardcoded destination; payouts gated until a method is set.

---

## 1.0.0 — Initial release
Initial payment platform: virtual terminal, hosted checkout, payment links (one-time + subscription), subscriptions with MRR, refunds, payouts, per-client API keys + `/v1` REST API, admin console with fee plans and per-client overrides, legal pages, and COMPLIANCE.md. Node + Express + file-backed JSON store, sandbox card network.
