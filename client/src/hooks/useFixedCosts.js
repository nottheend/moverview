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

export function buildFixedCosts(txs, months, anchorMonth, today = new Date()) {
  const inWindow    = new Set(months);
  const monthTotals = Object.fromEntries(months.map(m => [m, 0]));
  const byKey       = new Map();
  const misfiled    = [];   // tagged deposits — flagged, never counted

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

    const key = itemKeyOf(split);
    let item = byKey.get(key);
    if (!item) {
      item = {
        key,
        label: key,
        currency: split.currency_symbol || '€',
        currencyCode: split.currency_code || null,
        isTransfer: split.type === 'transfer',
        account: split.destination_name || split.source_name || null,
        byMonth: {},
        days: [],
        lastDate: null,
      };
      byKey.set(key, item);
    }
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

    // Cadence: an item present in most months since it first appeared is monthly.
    // Quarterly/annual items keep the tag but must not read as "missing" every month.
    const firstIdx = months.indexOf(seen[0]);
    const spanned  = firstIdx === -1 ? 0 : months.length - firstIdx;
    const monthly  = spanned > 0 && seen.length / spanned >= 0.6;

    let status = 'ok';
    if (current === 0) {
      const recentlySeen  = prev3.filter(m => item.byMonth[m] > 0).length >= 2;
      const dueDatePassed = !isCurrentMonth || today.getDate() > typicalDay;
      if (monthly && recentlySeen && dueDatePassed) status = 'missing';
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
      monthly,
      status,
      // What an irregular item costs per month once spread across the window
      amortised: monthly ? null : months.reduce((s, m) => s + (item.byMonth[m] || 0), 0) / months.length,
    };
  });

  // Sort: current month's biggest first, then items missing from this month,
  // then everything dormant.
  items.sort((a, b) => (b.current - a.current) || (b.expected - a.expected));

  const total     = monthTotals[anchorMonth] || 0;
  const active    = items.filter(i => i.current > 0);
  const missing   = items.filter(i => i.status === 'missing');
  const withHistory = months.filter(m => monthTotals[m] > 0);
  const average   = withHistory.length ? withHistory.reduce((s, m) => s + monthTotals[m], 0) / withHistory.length : 0;

  return { items, active, missing, misfiled, monthTotals, total, average };
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

export function useFixedCosts(anchorMonth, { tag = FIXED_TAG, enabled = true } = {}) {
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
    () => buildFixedCosts(txs, months, anchorMonth),
    [txs, months, anchorMonth]
  );

  return { ...report, months, loading, error };
}
