import { useEffect, useState, useMemo } from 'react';
import { firefly } from '../api.js';

// ── Fixed costs — the recurring commitments carrying the tag ──────────────────
//
// Definition: every tagged split that moves money *out* of an asset account.
// Transfers count — a paycheck lands as a transfer from the 'Paycheck' account in
// this setup, so transfer ≠ "not real money". Deposits are surfaced separately;
// a tagged deposit is almost always a tagging slip.

export const FIXED_TAG = 'monthly recurring expense';

// Income does not always arrive as a Firefly "deposit" here — the paycheck is
// booked as a transfer out of the 'Paycheck' account. Those transfers are income.
export const INCOME_SOURCE_ACCOUNTS = new Set(['Paycheck']);

const MONTHS_BACK    = 12;
const DRIFT_PCT      = 0.05;  // flag a charge deviating >5% from its own median
const MEDIAN_SAMPLE  = 6;     // months of history the expected amount is drawn from
const STALE_MONTHS   = 3;     // no charge for this long → probably cancelled, tag left behind

// ── Firefly bill schedules ───────────────────────────────────────────────────
//
// When a split carries a bill, the bill knows the real cadence and the real due
// date. That beats inferring both from past charges: an item that moved from the
// 1st to the 20th otherwise reads as overdue for three weeks every month.

const FREQ_MONTHS = { weekly: 0.25, monthly: 1, quarterly: 3, 'half-year': 6, yearly: 12 };
const FREQ_LABEL  = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', 'half-year': 'twice a year', yearly: 'yearly' };

export function billIndex(bills = []) {
  const map = new Map();
  for (const b of bills) {
    const attr = b?.attributes;
    // An inactive bill is not evidence that anything is still due — ignore it and
    // let the item fall back to what its own charge history says.
    if (!attr?.name || attr.active === false) continue;
    map.set(attr.name, attr);
  }
  return map;
}

// Months between charges, honouring Firefly's "skip n periods" setting
function billPeriodMonths(bill) {
  const base = FREQ_MONTHS[bill?.repeat_freq];
  if (!base) return null;
  return base * ((bill.skip || 0) + 1);
}

function billFreqLabel(bill) {
  const label = FREQ_LABEL[bill?.repeat_freq];
  if (!label) return null;
  return bill.skip ? `every ${(bill.skip || 0) + 1}× ${label}` : label;
}

// ── Month helpers — string maths, no timezone surprises ──────────────────────

export function monthKeyOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

export function currentMonthKey(today = new Date()) {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${key}-01`, end: `${key}-${String(last).padStart(2, '0')}` };
}

export function monthLabel(key, opts = { month: 'short', year: '2-digit' }) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', opts);
}

// The trailing window ending at (and including) the anchor month
export function monthWindow(anchorMonth, count = MONTHS_BACK) {
  const months = [];
  for (let i = count - 1; i >= 0; i--) months.push(addMonths(anchorMonth, -i));
  return months;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── Aggregation ──────────────────────────────────────────────────────────────
//
// Grouping key, first hit wins: bill → payee → description. Firefly bills are the
// strongest signal; payee is the reliable fallback because descriptions drift
// ("Netflix" vs "NETFLIX.COM 07/26").
function itemKeyOf(split) {
  return split.bill_name || split.destination_name || split.description || '—';
}

export function buildFixedCosts(txs, months, anchorMonth, { today = new Date(), bills = [] } = {}) {
  const inWindow    = new Set(months);
  const monthTotals = Object.fromEntries(months.map(m => [m, 0]));
  const byKey       = new Map();
  const misfiled    = [];   // tagged deposits — flagged, never counted
  const byCurrency  = {};   // anchor-month total per currency symbol — see mixedCurrency below
  const byBill      = billIndex(bills);

  for (const tx of txs) {
    const split = tx.attributes?.transactions?.[0];
    if (!split) continue;

    const month = monthKeyOf(split.date);
    if (!inWindow.has(month)) continue;

    const amount = Math.abs(parseFloat(split.amount || 0));
    if (!amount) continue;

    if (split.type === 'deposit') {
      misfiled.push({ date: split.date, description: split.description, amount, currency: split.currency_symbol || '€' });
      continue;
    }

    monthTotals[month] += amount;

    const symbol = split.currency_symbol || '€';
    if (month === anchorMonth) byCurrency[symbol] = (byCurrency[symbol] || 0) + amount;

    const key = itemKeyOf(split);
    let item = byKey.get(key);
    if (!item) {
      item = {
        key,
        label: key,
        currency: symbol,
        currencyCode: split.currency_code || null,
        billName: split.bill_name || null,
        isTransfer: split.type === 'transfer',
        account: split.destination_name || split.source_name || null,
        byMonth: {},
        days: [],
        lastDate: null,
      };
      byKey.set(key, item);
    }
    if (!item.billName && split.bill_name) item.billName = split.bill_name;
    item.byMonth[month] = (item.byMonth[month] || 0) + amount;
    item.days.push(new Date(split.date).getDate());
    if (!item.lastDate || split.date > item.lastDate) item.lastDate = split.date;
    // A key that shows up as both is dominated by whichever we saw last — rare,
    // and the row still totals correctly either way.
    item.isTransfer = split.type === 'transfer';
  }

  const isCurrentMonth = anchorMonth === currentMonthKey(today);
  const prev3 = [addMonths(anchorMonth, -1), addMonths(anchorMonth, -2), addMonths(anchorMonth, -3)];

  const items = [...byKey.values()].map(item => {
    const seen     = months.filter(m => item.byMonth[m] > 0);
    const history  = seen.filter(m => m !== anchorMonth).slice(-MEDIAN_SAMPLE).map(m => item.byMonth[m]);
    const expected = median(history);
    const current  = item.byMonth[anchorMonth] || 0;
    const typicalDay = Math.round(median(item.days)) || 1;

    // The bill, when there is one, is the authority on both cadence and due date.
    const bill        = item.billName ? byBill.get(item.billName) : null;
    const periodMonths = bill ? billPeriodMonths(bill) : null;
    const freqLabel   = bill ? billFreqLabel(bill) : null;

    // Cadence: an item present in most months since it first appeared is monthly.
    // Quarterly/annual items keep the tag but must not read as "missing" every month.
    const firstIdx = months.indexOf(seen[0]);
    const spanned  = firstIdx === -1 ? 0 : months.length - firstIdx;
    const monthly  = periodMonths !== null
      ? periodMonths <= 1
      : spanned > 0 && seen.length / spanned >= 0.6;

    // Due day: the bill's next expected date beats the median day of past charges.
    const dueDay = bill?.next_expected_match
      ? new Date(bill.next_expected_match).getDate()
      : typicalDay;

    // Months since the last charge — anchor month is the last slot in the window
    const lastSeen = seen[seen.length - 1];
    const monthsIdle = lastSeen ? months.length - 1 - months.indexOf(lastSeen) : null;

    let status = 'ok';
    if (current === 0) {
      // A bill is its own evidence that the item is still live; without one we
      // want two of the last three months before calling a charge overdue.
      const recentlySeen  = bill ? true : prev3.filter(m => item.byMonth[m] > 0).length >= 2;
      const dueDatePassed = !isCurrentMonth || today.getDate() > dueDay;
      if (monthly && recentlySeen && dueDatePassed) status = 'missing';
      // "Probably cancelled" has to clear the item's own rhythm, or every quarterly
      // charge would read as dead the month before it is due.
      else if (!bill && monthsIdle !== null &&
               monthsIdle >= Math.max(STALE_MONTHS, 2 * (spanned / seen.length))) status = 'stale';
      else status = 'idle';
    } else if (seen.length === 1) {
      status = 'new';
    } else if (expected > 0 && Math.abs(current - expected) / expected > DRIFT_PCT) {
      status = current > expected ? 'up' : 'down';
    }

    return {
      ...item,
      seen,
      expected,
      current,
      typicalDay,
      dueDay,
      monthsIdle,
      hasBill: !!bill,
      freqLabel,
      nextDue: bill?.next_expected_match || null,
      monthly,
      status,
      // What an irregular item costs per month once spread across the window
      amortised: monthly ? null : months.reduce((s, m) => s + (item.byMonth[m] || 0), 0) / months.length,
    };
  });

  // Rank by what an item costs when it is charged, not by whether it already hit
  // this month — otherwise a rent that has not been booked yet sorts below a €14
  // subscription, which is exactly when you want to see it at the top.
  const weight = i => Math.max(i.current, i.expected);
  items.sort((a, b) => weight(b) - weight(a));

  const total     = monthTotals[anchorMonth] || 0;
  const active    = items.filter(i => i.current > 0);
  const missing   = items.filter(i => i.status === 'missing');
  const stale     = items.filter(i => i.status === 'stale');
  const withHistory = months.filter(m => monthTotals[m] > 0);
  const average   = withHistory.length ? withHistory.reduce((s, m) => s + monthTotals[m], 0) / withHistory.length : 0;

  // Amounts are summed at face value — Firefly gives us no rate here, so a mixed
  // month is reported rather than silently converted at 1:1.
  const currencies = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]);

  return {
    items, active, missing, stale, misfiled, monthTotals, total, average,
    currencies,
    mixedCurrency: currencies.length > 1,
  };
}

// Income for a month, from transactions the dashboard already holds.
// Deposits plus transfers out of the accounts that pay us.
export function incomeForMonth(txs, month) {
  let income = 0;
  for (const tx of txs) {
    const split = tx.attributes?.transactions?.[0];
    if (!split || monthKeyOf(split.date) !== month) continue;
    const amount = Math.abs(parseFloat(split.amount || 0));
    if (split.type === 'deposit') income += amount;
    else if (split.type === 'transfer' && INCOME_SOURCE_ACCOUNTS.has(split.source_name)) income += amount;
  }
  return income;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFixedCosts(anchorMonth, { tag = FIXED_TAG, enabled = true, bills = [] } = {}) {
  const [txs,     setTxs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const months = useMemo(() => monthWindow(anchorMonth), [anchorMonth]);
  const start  = monthRange(months[0]).start;
  const end    = monthRange(months[months.length - 1]).end;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    firefly.taggedTransactions(tag, start, end)
      .then(data => { if (!cancelled) setTxs(data); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tag, start, end, enabled]);

  const report = useMemo(
    () => buildFixedCosts(txs, months, anchorMonth, { bills }),
    [txs, months, anchorMonth, bills]
  );

  return { ...report, months, loading, error };
}
