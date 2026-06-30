# Transfado — Compliance & Gap Analysis

> **Honest self-assessment.** Transfado is a complete, working **sandbox** payment platform — but a real, money-moving payment processor/facilitator carries legal, financial, and security obligations that software alone does not satisfy. This document lists what's built, what a production processor also has, and what you must put in place before touching real money. **None of this is legal advice — engage a fintech attorney and a sponsoring bank/PayFac partner before going live.**

---

## ✅ What Transfado already does

- Card charges, refunds (full/partial), and a virtual terminal
- Hosted checkout + shareable **payment links** (one-time and subscription)
- **Subscriptions** with recurring billing and **MRR** analytics
- **Payouts** to a merchant-defined debit card or bank account
- Per-client **fee plans** with a separate cost basis and client price → your margin
- Per-client fee overrides, suspend/reactivate
- Per-merchant **API keys** + a Stripe-style `/v1` REST API
- Admin (processor) console: volume, revenue, profit, MRR, per-client breakdowns
- Event/audit log, session auth (bcrypt), role separation (admin vs. merchant)
- Legal pages: Terms, Privacy Policy, Acceptable Use (see `/legal`)

---

## ❌ What real processors have that this doesn't (yet)

### Money movement & risk
| Capability | Status | Notes |
|---|---|---|
| Real card authorization/settlement | **Missing** | Uses a simulated card network. Needs an acquirer / processor / Stripe-Connect-style partner. |
| Bank/ACH/card payouts that actually move funds | **Missing** | Payout records exist; no real transfer rail. |
| **Disputes / chargebacks** | **Missing** | No dispute lifecycle, evidence submission, or reserves. Core to card processing. |
| Fraud & risk controls | **Minimal** | No AVS/CVC enforcement, velocity limits, ML risk scoring, or 3-D Secure. |
| Reserves / rolling holds | **Missing** | Processors hold funds to cover refunds/chargebacks. |
| Multi-currency / FX | **Missing** | USD only. |

### Compliance & legal
| Capability | Status | Notes |
|---|---|---|
| **PCI DSS** scope & tokenization | **Not met** | Card data must never be stored; use a tokenizing vault / hosted fields. (Sandbox stores test PANs only — replace before live.) |
| **KYC / KYB onboarding** | **Missing** | Identity/business verification (EIN, beneficial owners, bank validation) is legally required for a PayFac. |
| **AML / OFAC sanctions screening** | **Policy only** | Acceptable-Use lists prohibited businesses; no automated screening. |
| Money-transmitter / PayFac licensing | **Not addressed** | Holding/forwarding funds may require licensing or a sponsor bank. |
| **1099-K** and tax reporting | **Missing** | Processors issue tax forms to payees above thresholds. |
| Data-privacy rights (GDPR/CCPA) tooling | **Partial** | Privacy Policy written; no automated export/delete workflows. |

### Product / engineering
| Capability | Status | Notes |
|---|---|---|
| **Webhooks** (outbound event delivery) | **Missing** | Have an internal event log; no signed webhook delivery + retries. |
| **Idempotency keys** on the API | **Missing** | Prevents duplicate charges on retries. |
| Email/SMS receipts & notifications | **Simulated** | No real delivery. |
| Password reset, 2FA, login alerts | **Missing** | Basic session auth only. |
| Rate limiting / abuse protection | **Missing** | No throttling on auth or API. |
| CSV / report exports, reconciliation | **Missing** | No downloadable statements. |
| Saved customers / vaulted cards | **Partial** | Subscriptions store a card for re-bills; no customer vault UI. |
| HTTPS/TLS, secrets management, backups | **Deployment** | Run behind TLS; rotate `SESSION_SECRET`; back up the datastore. |

---

## 🔒 Before you process real money — checklist

1. **Get legal counsel** to review the Terms, Privacy Policy, and Acceptable Use, and to advise on licensing (money transmission / PayFac) in your state(s).
2. **Partner with a sponsor bank or a payments platform** (e.g. an acquirer or a Connect-style PayFac) so you are not directly holding card-network membership or PCI Level-1 scope.
3. **Replace `server/cards.js`** with the partner's tokenized authorization + settlement; never store raw PANs.
4. **Implement KYC/KYB onboarding** and **OFAC/sanctions screening** for every merchant.
5. **Add dispute/chargeback handling**, reserves, and refund-coverage logic.
6. **Stand up webhooks, idempotency, rate limiting**, password reset + 2FA, and real receipt delivery.
7. **Achieve PCI DSS compliance** (likely SAQ-A with hosted fields) and run security testing.
8. **Set up tax reporting** (1099-K) and record retention.
9. **Run behind HTTPS**, rotate secrets, migrate the datastore to a managed database with backups.

Until all of the above is in place, keep `PROCESSING_MODE=sandbox`. No real cards are charged and no real funds move.
