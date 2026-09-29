import React, { useState } from 'react';
import { fmt } from '../format.js';
import { monthLabel } from '../hooks/useFixedCosts.js';
import { useMonthlyTotals } from '../hooks/useMonthlyTotals.js';

// ── Income vs spending — the last 12 months at a glance ──────────────────────

const INCOME_FILL   = '#6ee7b7';
const SPENDING_FILL = '#f87171';

function MonthBars({ months, totals, avgSpending, selected, onPick }) {
  const W = 600, H = 130, PAD = { t: 10, r: 8, b: 20, l: 8 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max  = Math.max(...months.map(m => Math.max(totals[m].income, totals[m].spending)), 1);
  const slot = innerW / months.length;
  const barW = Math.min(14, slot * 0.3);
  const yOf  = v => PAD.t + innerH - (v / max) * innerH;
  const running = months[months.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
      aria-label="Income and spending per month">
      {months.map((m, i) => {
        const { income, spending } = totals[m];
        const x0 = PAD.l + i * slot;
        const mid = x0 + slot / 2;
        const isSel = m === selected;
        // The running month is still filling up — draw it faded
        const opacity = m === running ? 0.45 : 1;
        return (
          <g key={m} style={{ cursor: 'pointer' }} onClick={() => onPick(m)}>
            <rect x={x0} y={PAD.t} width={slot} height={innerH} rx="3"
              fill={isSel ? '#f5f5f4' : 'transparent'} />
            <rect x={mid - barW - 1} y={yOf(income)} width={barW} height={Math.max(innerH - (yOf(income) - PAD.t), 1)}
              rx="1.5" fill={INCOME_FILL} opacity={opacity} />
            <rect x={mid + 1} y={yOf(spending)} width={barW} height={Math.max(innerH - (yOf(spending) - PAD.t), 1)}
              rx="1.5" fill={SPENDING_FILL} opacity={opacity} />
            <text x={mid} y={H - 6} textAnchor="middle" fontSize="8" fill={isSel ? '#292524' : '#a8a29e'}>
              {monthLabel(m, { month: 'short' })}
            </text>
          </g>
        );
      })}
      {avgSpending > 0 && (
        <line x1={PAD.l} x2={PAD.l + innerW} y1={yOf(avgSpending)} y2={yOf(avgSpending)}
          stroke="#dc2626" strokeWidth="0.7" strokeDasharray="3 2" pointerEvents="none" />
      )}
    </svg>
  );
}

export default function MonthlyOverview() {
  const { months, totals, fullMonths, avgIncome, avgSpending, avgLeft, loading, error } = useMonthlyTotals();
  // Default to the last full month — the running one is not over yet
  const [selected, setSelected] = useState(() => months[months.length - 2]);

  const sel = totals[selected] || { income: 0, spending: 0 };
  const selLeft = sel.income - sel.spending;
  const isRunning = selected === months[months.length - 1];

  return (
    <section className="mb-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Income vs. spending</h2>

      <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
        <p className="px-4 pt-3 text-xs text-stone-500">
          Every withdrawal from any account, against every deposit. Transfers between your own accounts are left out.
        </p>

        {/* Averages over the last full months */}
        <div className="flex border-b border-stone-100">
          {[
            { label: 'Ø spending / month', value: `− ${fmt(avgSpending)}`, color: 'text-red-600' },
            { label: 'Ø income',           value: `+ ${fmt(avgIncome)}`,   color: 'text-emerald-600' },
            { label: 'Ø left over',        value: `${avgLeft >= 0 ? '+' : '−'} ${fmt(avgLeft)}`,
              color: avgLeft >= 0 ? 'text-emerald-600' : 'text-red-600' },
          ].map((item, i, arr) => (
            <div key={item.label} className={`flex-1 px-4 py-3 ${i < arr.length - 1 ? 'border-r border-stone-100' : ''}`}>
              <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">{item.label}</p>
              <p className={`text-lg font-bold tabular-nums ${item.color}`}>
                {loading ? <span className="text-stone-300">—</span> : item.value}
              </p>
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2.5 py-10">
            <span className="animate-spin" style={{
              width: 15, height: 15, flexShrink: 0,
              border: '2px solid #d6d3d1', borderTopColor: '#292524',
              borderRadius: '50%', display: 'inline-block',
            }} />
            <span className="text-sm text-stone-500">Loading monthly totals…</span>
          </div>
        )}

        {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}

        {!loading && !error && (
          <>
            <div className="border-b border-stone-100">
              <MonthBars months={months} totals={totals} avgSpending={avgSpending}
                selected={selected} onPick={setSelected} />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
              <span className="text-stone-500 uppercase tracking-wide">
                {monthLabel(selected, { month: 'long', year: 'numeric' })}{isRunning && ' (so far)'}
              </span>
              <span className="tabular-nums text-emerald-700">+ {fmt(sel.income)}</span>
              <span className="tabular-nums text-red-600">− {fmt(sel.spending)}</span>
              <span className={`tabular-nums font-semibold ${selLeft >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                = {selLeft >= 0 ? '+' : '−'} {fmt(selLeft)}
              </span>
              <span className="ml-auto text-stone-400">Ø over {fullMonths} full month{fullMonths === 1 ? '' : 's'}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
