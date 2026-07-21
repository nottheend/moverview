import React, { useMemo, useState } from 'react';
import { fmt, fmtDateShort } from '../format.js';
import {
  FIXED_TAG, useFixedCosts, incomeForMonth,
  currentMonthKey, addMonths, monthLabel, monthRange,
} from '../hooks/useFixedCosts.js';

// ── Fixed costs — what the month owes before anything is spent ───────────────

const STATUS = {
  missing: { label: 'not booked', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  up:      { label: '▲',          className: 'bg-red-50 text-red-600 border-red-200' },
  down:    { label: '▼',          className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  new:     { label: 'new',        className: 'bg-blue-50 text-blue-600 border-blue-200' },
  idle:    { label: '—',          className: 'bg-stone-50 text-stone-400 border-stone-200' },
};

function StatusBadge({ item }) {
  const s = STATUS[item.status];
  if (!s) return null;
  const pct = item.expected > 0 && item.current > 0
    ? Math.round(Math.abs(item.current - item.expected) / item.expected * 100)
    : null;
  const text = (item.status === 'up' || item.status === 'down') ? `${s.label} ${pct}%` : s.label;
  return (
    <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded border ${s.className} whitespace-nowrap`}>
      {text}
    </span>
  );
}

// ── 12-month bar strip ───────────────────────────────────────────────────────

function MonthBars({ months, monthTotals, anchorMonth, average, onPick }) {
  const W = 600, H = 110, PAD = { t: 10, r: 8, b: 20, l: 8 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(...months.map(m => monthTotals[m] || 0), 1);
  const slot = innerW / months.length;
  const barW = Math.min(34, slot * 0.62);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
      aria-label="Fixed costs per month">
      {average > 0 && (
        <line x1={PAD.l} x2={PAD.l + innerW}
          y1={PAD.t + innerH - (average / max) * innerH}
          y2={PAD.t + innerH - (average / max) * innerH}
          stroke="#a8a29e" strokeWidth="0.7" strokeDasharray="3 2" />
      )}
      {months.map((m, i) => {
        const v = monthTotals[m] || 0;
        const h = (v / max) * innerH;
        const x = PAD.l + i * slot + (slot - barW) / 2;
        const isAnchor = m === anchorMonth;
        return (
          <g key={m} style={{ cursor: 'pointer' }} onClick={() => onPick(m)}>
            <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={innerH} fill="transparent" />
            <rect x={x} y={PAD.t + innerH - h} width={barW} height={Math.max(h, 1)} rx="1.5"
              fill={isAnchor ? '#292524' : '#d6d3d1'} />
            {isAnchor && v > 0 && (
              <text x={x + barW / 2} y={PAD.t + innerH - h - 3} textAnchor="middle" fontSize="8" fill="#292524">
                {Math.round(v)}
              </text>
            )}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="8"
              fill={isAnchor ? '#292524' : '#a8a29e'}>
              {monthLabel(m, { month: 'short' })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onFilterAccount }) {
  const dim = item.current === 0;
  return (
    <button
      onClick={() => item.account && onFilterAccount(item.account)}
      className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm truncate ${dim ? 'text-stone-400' : 'text-stone-800'}`}>{item.label}</span>
          {item.isTransfer && <span className="text-xs text-indigo-500 shrink-0" title="Transfer">⇄</span>}
          {!item.monthly && (
            <span className="text-xs text-stone-400 shrink-0" title="Not charged every month">
              irregular{item.amortised ? ` · ${fmt(item.amortised, item.currency)}/mo` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-stone-400 mt-0.5">
          {item.lastDate ? `last ${fmtDateShort(item.lastDate)}` : '—'}
          {item.expected > 0 && ` · Ø ${fmt(item.expected, item.currency)}`}
        </p>
      </div>
      <StatusBadge item={item} />
      <span className={`text-sm font-semibold tabular-nums shrink-0 w-24 text-right ${dim ? 'text-stone-300' : 'text-stone-800'}`}>
        {item.current > 0 ? fmt(item.current, item.currency) : '—'}
      </span>
    </button>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export default function FixedCostsSection({
  open, onToggle, rangeTransactions, rangeStart, rangeEnd, onFilterTag, onFilterAccount,
}) {
  const [anchorMonth, setAnchorMonth] = useState(() => currentMonthKey());
  const [showAll, setShowAll] = useState(false);

  const { items, active, missing, misfiled, monthTotals, total, average, months, loading, error } =
    useFixedCosts(anchorMonth, { enabled: open });

  // Income is only trustworthy when the dashboard's loaded range covers the whole
  // anchor month — otherwise we'd divide by a partial month and overstate the ratio.
  const income = useMemo(() => {
    const { start, end } = monthRange(anchorMonth);
    if (!rangeStart || !rangeEnd || rangeStart > start || rangeEnd < end) return null;
    return incomeForMonth(rangeTransactions || [], anchorMonth);
  }, [rangeTransactions, rangeStart, rangeEnd, anchorMonth]);

  const share = income > 0 ? Math.round(total / income * 100) : null;
  const visible = showAll ? items : active;

  return (
    <section className="mb-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between mb-2 group">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
          Fixed costs
        </h2>
        <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">

          {/* Headline */}
          <div className="flex items-center gap-4 px-4 py-3 border-b border-stone-100">
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setAnchorMonth(m => addMonths(m, -1))}
                className="text-stone-300 hover:text-stone-600 transition-colors px-1" aria-label="Previous month">←</button>
              <span className="text-xs text-stone-500 uppercase tracking-wide w-20 text-center">
                {monthLabel(anchorMonth, { month: 'long', year: 'numeric' })}
              </span>
              <button onClick={() => setAnchorMonth(m => addMonths(m, 1))}
                disabled={anchorMonth >= currentMonthKey()}
                className="text-stone-300 hover:text-stone-600 disabled:opacity-25 disabled:cursor-not-allowed transition-colors px-1"
                aria-label="Next month">→</button>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-2xl font-bold tabular-nums text-stone-800 leading-tight">
                {loading ? <span className="text-stone-300">—</span> : fmt(total)}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                {active.length} item{active.length === 1 ? '' : 's'}
                {share !== null && ` · ${share}% of income`}
                {average > 0 && ` · Ø ${fmt(average)}`}
              </p>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2.5 py-10">
              <span className="animate-spin" style={{
                width: 15, height: 15, flexShrink: 0,
                border: '2px solid #d6d3d1', borderTopColor: '#292524',
                borderRadius: '50%', display: 'inline-block',
              }} />
              <span className="text-sm text-stone-500">Loading 12 months of tagged transactions…</span>
            </div>
          )}

          {error && (
            <p className="px-4 py-3 text-sm text-red-600">{error}</p>
          )}

          {!loading && !error && (
            <>
              {items.length === 0 ? (
                <p className="py-8 px-4 text-center text-stone-400 text-sm">
                  No transactions tagged “{FIXED_TAG}” in the last 12 months.
                </p>
              ) : (
                <>
                  {missing.length > 0 && (
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
                      {missing.length} not yet booked this month: {missing.map(i => i.label).join(', ')}
                    </div>
                  )}
                  {misfiled.length > 0 && (
                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
                      {misfiled.length} tagged deposit{misfiled.length === 1 ? '' : 's'} ignored — likely a tagging slip.
                    </div>
                  )}

                  <div className="border-b border-stone-100">
                    <MonthBars months={months} monthTotals={monthTotals} anchorMonth={anchorMonth}
                      average={average} onPick={setAnchorMonth} />
                  </div>

                  {visible.map(item => (
                    <ItemRow key={item.key} item={item} onFilterAccount={onFilterAccount} />
                  ))}

                  <div className="flex items-center justify-between px-4 py-2.5 bg-stone-50">
                    <button onClick={() => setShowAll(s => !s)}
                      className="text-xs text-stone-400 hover:text-stone-700 underline">
                      {showAll ? 'Only this month' : `Show all ${items.length} items`}
                    </button>
                    <button onClick={() => onFilterTag(FIXED_TAG)}
                      className="text-xs text-stone-400 hover:text-stone-700 underline">
                      Filter transactions by this tag
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
