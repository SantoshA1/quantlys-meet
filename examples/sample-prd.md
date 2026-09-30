# Sample PRD · Self-serve plan change

> **Specimen, not a customer recording.** This markdown mirrors the in-app
> labeled example at `/example-prd` so clones and OSS README pins can show
> the shape of a Quantlys Meeting PRD without opening the hosted product.
> Project: billing-v2 · 3 recorded meetings (fictional working session).

## Problem

Workspace admins email support to change plans. Finance cannot see proration
before the change lands. Two of three working sessions named this as the
reason upgrades stall.

## User stories

- As an admin, I can preview the next invoice before I confirm a plan change.
- As finance, I can see who changed a plan and the proration that applied.
- As an admin, I can downgrade without talking to support, with a clear
  effective date.

## Acceptance criteria

- Preview matches the invoice generated within $0.01.
- Downgrades take effect at period end unless the admin opts into immediate.
- Every plan change writes an audit row: actor, from-plan, to-plan,
  proration, timestamp.
- Free → Pro and Pro → Max work in one confirmation. Max → Free is blocked
  and routes to support.

## Decisions

- Decision caught · Maya: “We will not prorate downgrades mid-cycle.” · 18:14
- Decision caught · Jules: “Preview is a hard gate. No confirm button until
  the number is on screen.” · 22:03
- Conflict · Maya said no mid-cycle downgrade proration. Raj wanted immediate
  credit. Parking lot: revisit only if churn from that rule shows up in
  billing-v2 week 4.

## Non-goals

- No annual-contract self-serve in this pass.
- No seat-level plans.
- No sales-assisted quotes inside this flow.

## Open

- Tax on proration for EU VAT — parked. Jules to confirm with counsel.
- Whether failed payments on upgrade roll back the plan or keep Pro and
  retry — needs finance.
