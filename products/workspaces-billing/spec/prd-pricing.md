---
title: Workspaces & Billing — Pricing PRD
status: final
created: 2026-06-11
updated: 2026-06-11
governing_adr: docs/adr/0006-workspaces-seats-plans-and-usage-billing.md
---

# Workspaces & Billing — Pricing PRD

> **Accepted 2026-06-11 (Jia).** Values below are LOCKED for launch; revisable later via `bmad-prd` update + a decision-log entry.
> This PRD resolves the PRD-pending pricing in ADR 0006 / `requirements.md §8`.
> It fixes **pricing + packaging**; architecture lives in ADR 0006 / `design.md`.

## 1. Context & positioning

- The product is a paid, multi-researcher **workspace** (ADR 0006): seat
  subscription + usage on **completed interviews**, plans **Plus** and **Pro**.
- Market: AI-moderated interview unit cost has collapsed to **~$22/interview**
  (2025-26). Incumbents (Listen Labs, Outset) are **contact-sales, no self-serve,
  no transparent per-study pricing**. Seat-based qual tools sit ~$30-100/seat/mo.
- **Positioning bet**: transparent, self-serve Plus/Pro with a clear per-interview
  unit price well under the ~$22 legacy cost — undercut on price + remove the
  sales-call friction the incumbents impose.

## 2. Packaging model

Two dimensions (ADR 0006 D5): **seats** (recurring) + **usage** (completed
interviews). Included interviews are **pooled at the workspace level** (the
owner's "studies x interviews/study" sum), not per-seat.

| | **Plus** | **Pro** |
|---|---|---|
| Target | Small teams / solo going pro | Scaling research teams |
| Seat price | **$49 / seat / mo** | **$99 / seat / mo** |
| Included completed interviews / mo (pooled) | **50** | **200** |
| Overage per completed interview | **$8** | **$5** |
| Visual analysis (ADR 0004/0005) | — | included |
| Survey-level rollup report | — | included |
| Core (study editor, AI interview, transcript, session report) | included | included |
| Seats | per-seat, min 1 | per-seat, min 1 |

Rationale for the unit prices: Pro's $5/interview is ~4x under
the ~$22 market reference; Plus's $8 stays well under while preserving margin for
lower commitment. Higher tier = cheaper marginal interview (volume incentive).

## 3. Billing mechanics

- **Model**: monthly **subscription** for seats + **metered overage** for
  completed interviews beyond the pooled allowance, billed **in arrears**
  (Stripe metered billing). *Alternative considered: prepaid interview credits —
  simpler cash flow but worse UX for spiky usage; recommend metered post-pay.*
- **Annual option**: ~**17% off** (2 months free) on seats when billed annually.
- **Trial**: **14-day Pro trial**, no credit card to start; no perpetual free
  tier (B2B qual norm). *Alternative: a tiny free tier (1 seat, 5 interviews/mo).*
- **Overage behavior** past the pooled allowance: **soft** — continue serving,
  invoice overage next cycle; a **hard ceiling** (e.g. 2x allowance) trips
  `quota_exceeded` to stop runaway spend. (ADR 0006 D6 degrade-never-delete.)

## 4. Definition: "completed interview" (the billable unit)

A session bills (one `UsageEvent`, idempotent on `sessionId`) when ALL hold:

- `state == completed` (the agent finalized the session), AND
- duration `>= 60s`, AND
- `>= 1` substantive answer recorded.

This prevents trivially-short or abandoned sessions from being billed and
pre-empts disputes. Exact thresholds are tunable.

## 5. Success metrics & counter-metrics

- Success: paid-workspace conversion from trial; net revenue retention; interviews
  run per workspace per month.
- Counter-metric: **trial-to-paid drop from bill shock** — watch overage as a
  share of invoice; if overage routinely dwarfs subscription, the included
  allowance is mispriced.

## 6. Open decisions for Jia (confirm or edit each)

| # | Decision | Locked |
|---|---|---|
| D-1 | Seat price Plus / Pro | $49 / $99 per seat/mo |
| D-2 | Included interviews Plus / Pro (pooled/mo) | 50 / 200 |
| D-3 | Overage per completed interview Plus / Pro | $8 / $5 |
| D-4 | Billing model | subscription + metered overage (post-pay) |
| D-5 | Trial / free tier | 14-day Pro trial, no perpetual free tier |
| D-6 | "Completed interview" thresholds | state=completed + >=60s + >=1 answer |
| D-7 | Annual discount | ~17% (2 months free) |
| D-8 | Hard ceiling multiple (quota_exceeded trips) | 2x pooled allowance |
| D-9 | Feature split Plus vs Pro | visual analysis + survey rollup = Pro-only |

## 7. References

- ADR 0006 (architecture), `requirements.md §8` / `design.md §4` (metering).
- Market: AI-moderated interview ~$22/interview (alignify.co, Insights Association, 2025-26); incumbents contact-sales (listenlabs.ai, outset.ai).
- Stripe metered billing (mechanism; integration design in `design.md §4`).
