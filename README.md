# Pierson Pay

**Your own payment processor.** A Stripe-style payment platform by [Pierson Digital](https://piersondigitalmarketing.com) where **you are the processor** — you set your own cost basis and what each client pays, and the platform computes your margin on every transaction.

It does what Stripe does — card payments, hosted checkout, **payment links**, **subscriptions with MRR**, payouts, and a developer API — except *you* own the fee schedule, for yourself and for the clients you onboard.

---

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:4242**.

The database auto-seeds on first run with demo data (5 sample clients, ~230 transactions, active subscriptions for MRR, payment links, payouts).

### Logins

| Role | Email | Password |
|------|-------|----------|
| **Processor (you)** | `owner@piersondigitalmarketing.com` | `pierson123` |
| Client | `boochies@example.com` | `demo1234` |

There are five demo clients — `boochies@`, `aricka@`, `jermaine@`, `gloss@`, `mad@` (all `@example.com`, password `demo1234`). Or just create a new client account at **/signup**.

### Reset the data

```bash
npm run seed     # wipes data/db.json and reseeds fresh demo data
```

---

## What you get

### For you (the processor) — `/admin`
- **Platform overview**: total volume, your revenue (fees charged), **your profit** (margin after cost), processing cost, profit MRR, platform MRR, amount owed to clients.
- **Clients**: every merchant processing through you, with their plan, what they pay, your margin, volume, and your profit. Click any client to edit their fees or suspend them.
- **Fee plans**: define a **cost basis** (what processing costs you) and a **client price** (what they pay). The spread is your profit. Set a default and assign plans per client.
- **Per-client fee overrides**: tune any client's rate individually; margin recalculates live.
- **Transactions**: every charge across all clients, with your profit per transaction.
- **Recurring billing**: subscriptions auto-bill on a ticker; run a cycle manually any time.

### For your clients — `/dashboard`
- **Overview**: available balance, MRR, 30-day volume, fees paid, volume chart, recent activity.
- **Payments**: a **virtual terminal** to charge a card (with a live fee preview), full transaction history, one-click **refunds**.
- **Payment Links**: create shareable checkout links — **one-time or recurring** — copy the URL, enable/disable, track payments. Just like Stripe.
- **Subscriptions**: start recurring plans (weekly/monthly/yearly), see MRR and next billing date, cancel anytime.
- **Payouts**: add a **payout method** (debit card or bank account) and withdraw the available balance to it (simulated), with history.
- **Developers**: publishable + secret API keys (roll them), with a copy-paste cURL example.
- **Settings**: business profile, statement descriptor, and a view of their rate.

### Hosted checkout — `/pay/:linkId`
A clean, Stripe-like checkout page customers land on from a payment link. Handles one-time payments and subscriptions, custom ("pay what you want") amounts, and shows a receipt.

---

## The fee model (the whole point)

Every fee plan carries **two** rate pairs:

```
cost  = costPct  + costFixed    →  what processing "costs" you
price = pricePct + priceFixed   →  what the client is charged
```

On a charge of `amount`:

```
merchantFee   = price applied to amount    (deducted from the client)
processorCost = cost  applied to amount    (your underlying cost)
yourMargin    = merchantFee − processorCost  (your profit)
clientNet     = amount − merchantFee         (what the client keeps)
```

**Example — a $100.00 charge on "Pierson Standard" (cost 2.9%+$0.30, price 3.5%+$0.35):**

| | |
|---|---|
| Customer pays | $100.00 |
| Client is charged (price) | $3.85 |
| Your cost (cost basis) | $3.20 |
| **Your profit (margin)** | **$0.65** |
| Client receives | $96.15 |

---

## Developer API

Stripe-style REST API under `/v1`, authenticated with a Bearer secret key. Full reference at **/docs**. All amounts are integer **cents**.

```bash
curl http://localhost:4242/v1/charges \
  -H "Authorization: Bearer sk_sandbox_xxx" \
  -H "Content-Type: application/json" \
  -d '{"amount":2500,"description":"Order #1234",
       "card":{"number":"4242424242424242","exp_month":12,"exp_year":2030,"cvc":"123"}}'
```

Endpoints: `POST/GET /v1/charges`, `POST /v1/refunds`, `POST/GET /v1/subscriptions`, `POST /v1/subscriptions/:id/cancel`, `POST/GET /v1/payment_links`, `GET /v1/balance`, `GET /v1/account`.

### Test cards (sandbox)

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Visa — approves |
| `5555 5555 5555 4444` | Mastercard — approves |
| `3782 822463 10005` | Amex — approves |
| `4000 0000 0000 0002` | Declined (generic) |
| `4000 0000 0000 9995` | Declined (insufficient funds) |

Any future expiry, any 3-digit CVC (4 for Amex).

---

## Legal & compliance

- **Legal pages** at `/legal` — Terms of Service, Privacy Policy, and an Acceptable Use Policy (prohibited businesses / AML) with operator-protective disclaimers (sandbox notice, not-a-bank, no-warranty, limitation of liability, indemnification). Linked from the landing footer, checkout, dashboards, and a required consent checkbox at signup.
- **[COMPLIANCE.md](COMPLIANCE.md)** — an honest gap analysis of what a production processor needs that this MVP doesn't yet (real settlement, disputes/chargebacks, PCI tokenization, KYC/KYB, OFAC screening, webhooks, idempotency, licensing, 1099-K, etc.) plus a go-live checklist.

> ⚠️ The legal pages are **templates, not legal advice** — have a licensed attorney review and adapt them before any real, commercial, or money-handling use.

## Architecture

```
server/
  index.js        Express app, routes, clean URLs, recurring-billing ticker
  config.js       Loads .env (zero-dependency)
  db.js           File-backed JSON store (atomic writes) — swap for SQL later
  auth.js         Sessions (bcrypt + cookies), API-key auth, route guards
  fees.js         The fee engine (cost vs. price → margin)
  cards.js        Simulated card network (Luhn + test cards) — swap for a real acquirer
  charges.js      Create / refund charges; credit balances
  billing.js      Subscriptions, recurring re-bills, MRR analytics
  merchants.js    Merchant + API-key creation, event log
  links.js        Payment links
  metrics.js      Platform & merchant analytics (volume, profit, time series)
  seed.js         Demo data
  routes/         auth, merchant, admin, public (checkout), api (/v1)
public/           Brand CSS + vanilla-JS pages (no build step)
data/db.json      Runtime database (git-ignored; delete to reset)
```

**Stack:** Node + Express + a tiny JSON datastore. Three pure-JS dependencies (`express`, `bcryptjs`, `cookie-parser`) — no native builds, no build step, runs anywhere Node 18+ runs.

### Configuration (`.env`, optional)

Copy `.env.example` to `.env`. Override `PORT`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

---

## Going live with real money

Pierson Pay ships in **sandbox mode** — it simulates the card network so the entire product works end-to-end with no external accounts. The seams to connect real money movement are isolated:

1. **Card processing** — replace `server/cards.js` with a real acquirer / processor integration (e.g. an issuing-and-acquiring partner, or Stripe Connect where you are the platform taking an `application_fee`). `charges.js` already produces the exact fee split a platform model needs.
2. **Payouts** — wire `server/routes/merchant.js` payouts to real bank transfers (ACH/RTP) via your banking partner.
3. **Persistence** — swap `server/db.js` for Postgres/SQLite (the route handlers only use `insert/find/update/remove`).
4. **Compliance** — operating as a real payment facilitator requires PCI DSS scope, KYC/onboarding, and a sponsoring acquirer or PayFac partner. Those are business/legal steps, not code.

Until then, no real cards are charged and no real funds move.
