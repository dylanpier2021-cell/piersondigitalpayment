# Transfado — Rebrand + Make It Real (build brief)

Read this whole thing before touching code. The app currently works end-to-end in sandbox (Node + Express + vanilla JS, file-backed JSON DB, no build step). It's functional but it still looks and feels like a demo. I want you to turn it into **Transfado** — a payment platform that looks like the *new* way to get paid, not a Stripe clone, not "broke stuff." Premium, modern, alive.

**Hard rule: when you're done, everything actually works.** No broken buttons, no dead links, no console errors, no half-finished screens. Keep the existing test suites green (the 95-check API contract test + the 22-check jsdom render test) and add tests for anything new. Reseed the demo data so every screen looks full and alive. If you build a feature, wire it fully — UI → API → data → tests.

---

## 1. Finish the rebrand: Pierson Pay → Transfado

- Replace **"Pierson Pay" / "PiersonPay"** everywhere (titles, nav, footers, console banner, `platformName`, statement-descriptor default `PIERSON PAY`, package name `pierson-pay`, README, comments) with **Transfado**.
- Brand lockup is currently `Pierson<small>Pay</small>` with a `P` brand-mark. Make it **`Trans<small>fado</small>`** with a **`T`** mark. Design a real wordmark, not just a letter in a box — give the mark some character (custom geometric "T", subtle gradient, maybe a motion/transfer glyph).
- **Keep "Pierson Digital"** intact — that's the parent company. Footer line stays "A product of Pierson Digital." Keep internal code field names (`piersonMargin`, `piersonProfit`, `piersonMrr`, etc.) as-is so nothing breaks; they're never shown to users.
- Tagline / positioning: lean into **"the new way to get paid"** — confident, a little bold, anti-incumbent. Write hero + section copy that sounds like a 2025 fintech, not a template.
- Add real brand assets: favicon, OG/social image, app icons (for PWA).

## 2. Make it *feel* like real software (design system overhaul)

Right now it's a flat dark theme. Rebuild it into a cohesive, premium design system. Define real design tokens (color, type scale, spacing, radius, shadow, motion) and use them everywhere — no one-off inline styles.

**Aesthetic targets to study and borrow from (these are the bar):**
- **Mercury** (mercury.com) — that trustworthy-bank feel: immaculate data tables, soft layered depth, generous whitespace.
- **Linear** (linear.app) — buttery 60fps transitions, ⌘K command palette, gradient-on-dark, keyboard-first.
- **Ramp / Brex** — bold confident typography, money-green accents, "serious money" energy.
- **Vercel / Geist** — sharp monochrome geometry, crisp type (consider the Geist or Inter font for UI).
- **Arc browser / Raycast** — spring physics, glass/vibrancy, little moments of delight.
- **Cash App / Revolut** — bold, color-forward, "new money" attitude (this is the differentiator vs. Stripe's restraint).

**Specific effects to actually implement (steal these):**
- Aurora / mesh-gradient backgrounds on hero + auth + checkout (animated, subtle).
- A faint film-grain/noise overlay so flat areas don't look cheap.
- Glassmorphism on the top nav and floating cards (backdrop-blur, hairline gradient borders).
- Animated count-up on all the big numbers (balance, MRR, volume, profit).
- Charts that **draw on** when they enter; tasteful tooltips; gradient area fills.
- A real success moment on a paid checkout: spring-animated checkmark + a tasteful confetti burst.
- Skeleton **shimmer** loaders instead of bare spinners.
- Hover states with subtle lift + glow; visible focus rings; pressed states on buttons.
- **⌘K command palette** for navigation/actions (very "new software").
- **Dark mode as default + a light theme toggle**, both first-class.
- Page/route transitions and staggered list-item entrances.
- Respect `prefers-reduced-motion` (turn the motion off for users who ask).
- Custom illustrated empty states (not just an emoji).

Typography: pick a real pairing (e.g., a strong display face + Inter/Geist for UI) and apply a consistent type scale. Tighten spacing to an 4/8px rhythm.

## 3. Stuff I didn't say but you should add (real-processor parity)

The product is missing things every real processor has. Build these (sandbox-simulated where money/email would be real), fully wired with UI + API + tests:

**Payments / money:**
- Email **receipts + notifications** (payment received, payout sent, subscription renewed, payment failed) — build the templates and a notifications/activity log even if delivery is simulated.
- **Disputes / chargebacks** flow (raise, evidence, win/lose states).
- **Authorizations + captures** (hold then capture), partial captures, refund reasons.
- **Invoices**: create, send, hosted invoice page, downloadable **PDF** receipt/invoice.
- **Customer vault**: saved customers + reusable saved cards (never store CVC).
- **Apple Pay / Google Pay / express checkout** buttons on hosted checkout (simulated).

**Developer platform (devs expect these):**
- **Webhooks**: create endpoints, signed events, delivery log, retries, test-send.
- **Idempotency keys**, API versioning header, basic rate limiting, clear error objects.
- Expand `/docs` into a real, beautiful API reference (split-view, copyable, language tabs).

**Growth / sharing:**
- **QR code** for every payment link + **rich link previews** (per-link OG image so shared links look pro).
- Merchant **checkout branding** (their logo + accent color on the hosted page).

**Trust / ops / account:**
- Merchant **onboarding/KYC wizard** (simulated) with verification states + a first-login checklist.
- **Security**: 2FA, login history, active sessions, password change.
- **Team members + roles** per merchant.
- **Notification preferences**.
- **Risk/fraud signals**: simple risk score, velocity caps, flagged transactions.
- **Reporting**: transaction **search + filters + date ranges**, **CSV export** (transactions/payouts), MRR movement (new/expansion/churn), payout schedule.
- A **status/health** page.

**Platform polish:**
- Full **responsive** pass (320px → 1440px) + **PWA / installable** + mobile nav.
- **Accessibility** pass: keyboard nav, ARIA, color contrast, focus management.

> Note: the payout **destination** was hardcoded to "••••6789." Make sure merchants can add/edit a real payout method (debit card or bank) and that payouts route to and display *that*. (This may already be partially built — verify it works end to end.)

## 4. The pricing hook (home page hero)

Our whole angle is **we're cheaper than everyone**. Make this the #1 thing on the home page: a bold headline + an animated comparison table that shows Transfado's rate beating every major processor. I researched current (mid-2026) published US online/card-not-present rates — use these numbers, and add a small "rates as published [month/year]; verify before launch" disclaimer:

| Processor | Online rate | Monthly fee |
|---|---|---|
| PayPal | 3.49% + $0.49 | — |
| Clover | 3.5% + $0.10 | from $0 |
| Stripe | 2.9% + $0.30 | — |
| Braintree | 2.9% + $0.30 | — |
| Shopify Payments | 2.9% + $0.30 | — |
| Amazon Pay | 2.9% + $0.30 | — |
| Authorize.net | 2.9% + $0.30 | + $25/mo |
| Square | 2.6% + $0.10 | — |
| Adyen | $0.13 + interchange (~2.2%+ effective) | — |
| Helcim | interchange + 0.5% + $0.25 (~2.2%+ effective) | — |
| **Transfado** | **2.5% + $0.10** | **none** |

- Set Transfado's **public flat rate to 2.5% + $0.10** — the lowest simple flat rate on the board, no monthly fee. (If you want even more shock value, 2.4% + $0.10 still beats everyone; your call, but keep it consistent everywhere.)
- **Important for the demo's internal math:** the app's fee engine separates *cost basis* (what processing costs us) from *client price*. For the new low price to still show a positive margin, set the seeded default plan's **cost basis to roughly interchange-level (~1.8% + $0.08)** and the **client price to 2.5% + $0.10**. Margin stays positive and realistic.
- Build the comparison as a real animated section: bars/rows that sort and highlight Transfado at the bottom (cheapest), count-up on the percentages, "you save $X on every $1,000" calculator where the visitor can type their monthly volume and instantly see savings vs Stripe/PayPal/Square. That savings calculator is the hook — make it interactive and slick.
- Headline direction: something like **"Lower fees than every major processor. No monthly fee. No games."**

## 5. Coupons / fee-waiver codes

Add a **coupon system** so fees can be discounted or **fully waived (0% + $0)** — this is both a sales tool and a way for me to onboard people free.

- Data model: `coupons` collection — `code`, `type` (`fee_waiver` | `percent_off` | `fixed_off`), `value`, `scope` (platform-wide, specific merchant, or single checkout), `maxRedemptions`, `redemptions`, `expiresAt`, `active`.
- **Admin** (`/admin`): create/edit/disable coupons, see redemption counts. Include a built-in code like **`FREE`** that sets a merchant's effective processing fee to **zero** (0% + $0) — no fee on anything while active.
- **Apply paths:** (a) admin attaches a coupon to a client → that client's effective fee is reduced/zeroed in the **fee engine**; (b) a merchant enters a code in their dashboard to redeem; (c) optional code field on hosted checkout for one-off waivers.
- **Fee engine:** when a `fee_waiver` coupon is active for a merchant, `computeFees` returns `merchantFee = 0`, `merchantNet = amount`, and Pierson margin = 0 (or negative cost if you still book cost — make it 0/0 for the free case). Make sure balances, payouts, MRR, and the admin profit numbers all stay correct when fees are zeroed.
- Show it in the UI: a "Fees waived" badge on the merchant dashboard and on the rate display when a free coupon is applied.
- Tests: cover coupon creation, redemption, expiry, max-redemptions, and that a `FREE` coupon makes a charge net 100% to the merchant with zero fee.

## 6. Quality bar (non-negotiable)

- Keep the existing **contract + render test suites passing**; add tests for every new feature.
- **Zero console errors/warnings** on every page. No unhandled promise rejections.
- Re-seed rich demo data so all dashboards, charts, lists, disputes, invoices, webhooks, etc. look populated.
- Verify visually: take screenshots of every screen (landing, auth, merchant dashboard tabs, hosted checkout + success, admin console, docs, legal) in **both** dark and light, desktop and mobile.
- Don't introduce a heavy framework that breaks the zero-build simplicity unless you keep everything working and tested. CDN libs are fine.
- Don't break the legal pages (privacy, terms, acceptable-use) or the COMPLIANCE.md that already exist — restyle them to match the new brand.

## 7. Theme switching + multi-language (must-have)

- **Light / dark mode toggle:** ship both themes as first-class, driven by CSS variables/design tokens (no hardcoded colors). Toggle lives in the top bar *and* in Settings. Default to the OS preference (`prefers-color-scheme`), let the user override, and **remember the choice** (localStorage / cookie). Every screen — landing, auth, dashboard, admin, hosted checkout, docs, legal — must look intentional in both. No unreadable contrast anywhere.
- **Full internationalization (any language):** externalize **all** UI strings into locale files (e.g. `/locales/en.json`, `es.json`, `fr.json`, …) — no hardcoded English in the markup or JS. Add a language switcher (top bar + settings) that swaps locale live and **persists** it. Ship at least **English, Spanish, French, German, Portuguese**, and structure it so adding a language is just dropping in one JSON file. Localize numbers, currency, and dates with `Intl`. Make the hosted checkout respect a `?lang=` param so a shared payment link can open in the payer's language. Keep the layout intact for longer translations (don't let text overflow buttons). Add `lang`/`dir` attributes correctly (leave room for RTL later).
- Tests: assert the theme toggle persists and that switching locale actually swaps rendered strings.

## 8. When you're done

Give me: a short changelog, the test results (all green), the screenshots, and confirmation that `npm install && npm start` boots clean and every feature works. Then commit and push to the existing GitHub repo.

**North star:** someone opens Transfado and thinks "this is the future of getting paid" — and then every button they press actually works.
