# Proposal — Monthly expenses (fixed costs) report

**Status:** proposal, not implemented
**Scope:** read-only, client + one optional API helper. No writes to Firefly.

---

## 1. The question the report answers

> "What do I have to pay every month no matter what, is anything missing or drifting,
> and how much of my income is already spoken for before I spend a cent?"

Today the dashboard can *filter* to the tag (`?tag=monthly recurring expense`) and the Tags
section shows one lump sum — but only for the currently selected period, mixed with
non-recurring spend, with no per-item breakdown and no history.

---

## 2. Definition — what counts as a fixed expense

A transaction **split** counts when its `tags` array contains the tag
`monthly recurring expense`.

Rules, to be explicit up front:

| Rule | Decision | Why |
|---|---|---|
| Matching | exact string, case-insensitive, trimmed | Firefly tags are user-typed; `Monthly Recurring Expense` should not silently drop out |
| Splits | tag is evaluated **per split**, not per group | `api.js` already flattens splits ([api.js:27](../../client/src/api.js:27)); a €90 group where only the €30 insurance split is tagged must contribute €30 |
| Type | `withdrawal` counts toward the total | it's an expense report |
| Transfers | listed in a separate "committed transfers" line, **not** in the headline | savings/`Paycheck`-style internal moves are recurring but not costs — folding them in double-counts |
| Deposits | excluded, shown as a warning row | a tagged income row is almost always a tagging mistake |
| Currency | grouped by `currency_code`; headline shows the dominant currency, others listed separately | never silently add €/CHF together |

---

## 3. Data source

Firefly has a tag-scoped endpoint, so we don't have to over-fetch and filter in the browser:

```
GET /api/firefly/tags/monthly%20recurring%20expense/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=500
```

The existing proxy passes this through unchanged ([server/index.js:52](../../server/index.js:52)) —
`req.path` is not percent-decoded by Express, so the encoded space survives. **Verify this once
before building**; the fallback is a client-side filter over `firefly.transactions()`, which
works but forces a 12-month, all-transaction fetch.

**Window:** the report always uses **calendar months** — the current month plus the trailing
11 — independent of the dashboard's date picker, which is driven by *budget* periods that
are not calendar-aligned (see `budgetPeriods`, [DashboardPage.jsx:1044](../../client/src/pages/DashboardPage.jsx:1044)).
One request covers the whole window; everything else is derived client-side.

New method in `client/src/api.js`:

```js
firefly.taggedTransactions(tag, startStr, endStr)  // returns flattened splits, same shape as .transactions()
```

Reusing the same split-flattening helper as `firefly.transactions` — worth extracting it
rather than copy-pasting.

---

## 4. What the report shows

### a) Headline strip (always visible)

```
FIXED COSTS · JULY 2026
€1.842,50        14 items        61% of income        ⚠ 2 not yet booked
```

- **Total** — sum of tagged withdrawals in the anchor month
- **Item count**
- **% of income** — against `periodSummary.income` for the same month; the single most
  useful number in the report, and the app already computes income
- **Not yet booked** — items seen in ≥2 of the last 3 months with nothing in the anchor month

### b) Item table (the core)

One row per recurring commitment, sorted by amount descending:

| Item | Last charged | This month | Ø 6 months | Trend |
|---|---|---|---|---|
| Miete | 01.07. | €980,00 | €980,00 | — |
| Krankenkasse | 03.07. | €412,30 | €389,10 | ▲ 6% |
| Netflix | — | *missing* | €13,99 | ⏳ |

**Grouping key**, first match wins: `bill_name` → `destination_name` (payee) → `description`.
Firefly bills are the strongest signal and the app already surfaces them
([BillRow](../../client/src/pages/DashboardPage.jsx:103)); payee is the reliable fallback
because descriptions drift ("Netflix", "NETFLIX.COM 07/26").

**Ø 6 months** = median, not mean — one annual insurance payment shouldn't distort the row.
**Trend** flags when the latest charge deviates >5% from the median: the "your subscription
quietly went up" detector.

Each row is clickable and applies the existing filters (`tag` + `acct`), so it drops the user
straight into the transaction list — consistent with how every other chip in the app behaves.

### c) 12-month bar strip

Twelve bars, one per month, total fixed cost. Plain SVG in the style of `AccountLineChart`
([DashboardPage.jsx:295](../../client/src/pages/DashboardPage.jsx:295)) — no new dependency.
Clicking a bar re-anchors the report to that month.

### d) Optional second phase

- **Runway line**: "fixed costs are covered until day 23 by current balances"
- **Cross-check against Firefly bills**: bills with no tagged transaction, and tagged items
  with no bill — a tagging-hygiene panel

---

## 5. Placement in the UI

A new collapsible `<section>` titled **Fixed costs**, sitting directly under the period
summary strip and above **Budgets** — it belongs with the "what is my month made of"
block, not down with the reference sections.

Collapsed by default except the headline strip, matching Accounts/Bills/Tags behaviour.
Open state persists via a `fixed=1` search param, consistent with the URL sync added in
`a44ec9b`/`92e48d1`.

---

## 6. Edge cases worth naming now

1. **Quarterly/annual items carrying the tag.** Common in practice. Handling: show them with
   a `¼` / `¹²` badge and their amortised monthly equivalent in a separate "amortised" subtotal,
   never mixed into the headline.
2. **Mid-month reporting.** Late-in-month items look "missing" on the 5th. The missing check
   only fires when the item's typical day-of-month has already passed.
3. **Renames.** "Vodafone" → "Vodafone GmbH" splits into two rows. Accepted for v1;
   a manual alias map is the escape hatch if it bites.
4. **Firefly pagination.** `limit=500` on a 12-month tag query should be ample, but the
   response's `meta.pagination` must be checked and a second page fetched rather than
   silently truncating — the current code never checks this anywhere.
5. **Empty state.** Tag doesn't exist / no matches → the section renders a one-line hint
   with the exact tag string, not a blank box.

---

## 7. Implementation plan

| Phase | Work | Files |
|---|---|---|
| 0 | Confirm the tag endpoint survives the proxy (one curl) | — |
| 1 | `firefly.taggedTransactions()` + extract split-flattening helper | `client/src/api.js` |
| 2 | `useFixedCosts(anchorMonth)` hook: fetch 12 months, group, median, missing/drift detection — pure functions, unit-testable | new `client/src/hooks/useFixedCosts.js` |
| 3 | Headline strip + item table | new `client/src/components/FixedCostsSection.jsx` |
| 4 | 12-month bar strip, click-to-anchor | same |
| 5 | Wire into `DashboardPage`, URL param, filter hand-off | `client/src/pages/DashboardPage.jsx` |

Phases 1–3 are the useful minimum and are independently shippable.

**Note on `DashboardPage.jsx`:** it is at 1523 lines and this adds to it. The new work goes
into `components/` (currently an empty directory), so the page only gains the section wiring.

---

## 8. Open decisions

1. **Tag string** — is `monthly recurring expense` the exact, only tag in use, or are there
   variants worth folding in?
2. **Transfers** — proposal excludes them from the headline. If tagged transfers are meant
   as committed savings, they arguably belong in a "committed outflow" total instead.
3. **Anchor month** — always the current calendar month, or follow the date picker when the
   selected range happens to be one?
