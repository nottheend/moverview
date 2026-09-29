import { useEffect, useState, useMemo } from 'react';
import { firefly } from '../api.js';
import { monthWindow, monthRange, currentMonthKey } from './useFixedCosts.js';

// ── Income vs spending per calendar month ────────────────────────────────────
//
// Spending = every withdrawal, whichever account it left from. Income = every
// deposit. Transfers are left out: money moving between your own accounts is
// neither — which also keeps the salary from counting twice (it is booked as a
// deposit into 'Paycheck' and then transferred on).
//
// Firefly's insight endpoints do the summing server-side: two tiny requests per
// month instead of a year's worth of transactions.

const FULL_MONTHS = 12;

export function buildMonthlyTotals(totals, months) {
  // The running month is not over yet — it would drag every average down.
  // Months with no bookings at all predate the data and are skipped too.
  const full = months.slice(0, -1).filter(m => totals[m]?.income || totals[m]?.spending);
  const avg  = key => full.length ? full.reduce((s, m) => s + totals[m][key], 0) / full.length : 0;
  const avgIncome   = avg('income');
  const avgSpending = avg('spending');
  return { fullMonths: full.length, avgIncome, avgSpending, avgLeft: avgIncome - avgSpending };
}

async function fetchMonth(month) {
  const { start, end } = monthRange(month);
  const [income, spending] = await Promise.all([
    firefly.insightTotal('income',  start, end),
    firefly.insightTotal('expense', start, end),
  ]);
  return [month, { income, spending }];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMonthlyTotals() {
  // The last 12 full months plus the running one
  const months = useMemo(() => monthWindow(currentMonthKey(), FULL_MONTHS + 1), []);
  const empty  = useMemo(() => Object.fromEntries(months.map(m => [m, { income: 0, spending: 0 }])), [months]);

  const [totals,  setTotals]  = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all(months.map(fetchMonth))
      .then(entries => { if (!cancelled) setTotals(Object.fromEntries(entries)); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [months]);

  const report = useMemo(() => buildMonthlyTotals(totals, months), [totals, months]);

  return { ...report, totals, months, loading, error };
}
