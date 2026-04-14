import React, { useEffect, useState, useMemo, useRef } from 'react';
import { firefly } from '../api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount, symbol = '€') {
  const n = parseFloat(amount);
  return `${symbol}${Math.abs(n).toLocaleString('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit',
  });
}

// For period labels — always include year
function fmtDatePeriod(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// Safely extract YYYY-MM-DD from either "2026-03-01" or "2026-03-01T00:00:00+00:00"

function txType(split) {
  if (split.type === 'withdrawal') return 'expense';
  if (split.type === 'deposit')    return 'income';
  return 'transfer';
}

// ── Chip style constants ─────────────────────────────────────────────────────
// Single source — used in both mobile cards and desktop rows

const CHIP = {
  cat:     'inline-flex items-center text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-sm border-l-2 border-blue-300 font-medium hover:bg-blue-100 transition-colors cursor-pointer',
  budget:  'inline-flex items-center text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full border border-stone-200 hover:bg-stone-200 transition-colors cursor-pointer',
  tag:     'inline-flex items-center gap-1 text-xs bg-[#faf8f2] text-[#b8a06a] pl-1.5 pr-2.5 py-0.5 rounded-r-full border-l-2 border-[#ddd0a8] hover:bg-amber-50 transition-colors cursor-pointer',
  account: 'inline-flex items-center text-xs bg-white text-stone-600 px-2 py-0.5 rounded border border-stone-400 hover:bg-stone-50 transition-colors cursor-pointer tracking-tight',
  accountArrow: 'text-xs text-stone-400',
  bill:    'inline-flex items-center text-xs text-stone-500 px-2 py-0.5 cursor-pointer hover:text-stone-800 transition-colors',
};

function TagDot() {
  return <span style={{width:5,height:5,borderRadius:'50%',background:'#b8a06a',flexShrink:0,display:'inline-block'}} />;
}

function SectionSpinner({ label }) {
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
      <span className="animate-spin" style={{
        width:13, height:13, flexShrink:0,
        border:'2px solid #d6d3d1', borderTopColor:'#292524',
        borderRadius:'50%', display:'inline-block',
      }} />
      {label && <span style={{fontSize:11, color:'#78716c'}}>{label}</span>}
    </span>
  );
}

// ── Bill chip — ticket style ──────────────────────────────────────────────────

function BillChip({ name, onClick }) {
  return (
    <button onClick={onClick} className={CHIP.bill} style={{
      background: '#fff',
      border: '1px solid #a8a29e',
      borderRadius: 3,
      position: 'relative',
      paddingLeft: 10,
      paddingRight: 10,
    }}>
      {/* left notch */}
      <span style={{
        position: 'absolute', left: -5, top: '50%', transform: 'translateY(-50%)',
        width: 9, height: 9, borderRadius: '50%',
        background: '#fafaf9', border: '1px solid #a8a29e',
        boxSizing: 'border-box',
      }} />
      🧾 {name}
      {/* right notch */}
      <span style={{
        position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)',
        width: 9, height: 9, borderRadius: '50%',
        background: '#fafaf9', border: '1px solid #a8a29e',
        boxSizing: 'border-box',
      }} />
    </button>
  );
}

// ── Bill row (collapsible section) ────────────────────────────────────────────

function BillRow({ bill, isActive, onClick }) {
  const attr = bill.attributes || {};
  const isPaid = attr.paid_dates?.length > 0;
  const nextDue = attr.next_expected_match;
  const amount = attr.amount_min === attr.amount_max
    ? fmt(attr.amount_min, attr.currency_symbol)
    : `${fmt(attr.amount_min, attr.currency_symbol)}–${fmt(attr.amount_max, attr.currency_symbol)}`;

  const overdue = nextDue && new Date(nextDue) < new Date() && !isPaid;

  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between px-4 py-2.5 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors text-left ${isActive ? 'bg-stone-50' : ''}`}>
      <div className="flex items-center gap-2">
        {/* ticket icon */}
        <span className="text-stone-300 text-xs">🧾</span>
        <span className={`text-sm ${isActive ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>{attr.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${isPaid ? 'bg-emerald-50 text-emerald-600' : overdue ? 'bg-red-50 text-red-500' : 'bg-stone-100 text-stone-400'}`}>
          {isPaid ? 'paid' : overdue ? 'overdue' : 'unpaid'}
        </span>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm tabular-nums text-stone-600">{amount}</p>
        {nextDue && <p className="text-xs text-stone-400 mt-0.5">{fmtDate(nextDue)}</p>}
      </div>
    </button>
  );
}


// ── Group transactions by date ────────────────────────────────────────────────

function groupByDate(transactions) {
  const groups = {};
  for (const tx of transactions) {
    const split = tx.attributes?.transactions?.[0] || {};
    const date = split.date?.slice(0, 10) || 'unknown';
    if (!groups[date]) groups[date] = [];
    groups[date].push(tx);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

const PAGE_SIZE = 30;

// ── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-stone-800 text-white text-xs rounded-full px-3 py-1.5">
      {label}
      <button onClick={onClear} className="hover:text-stone-300 font-bold leading-none text-base">×</button>
    </span>
  );
}

// ── Clickable filter value ────────────────────────────────────────────────────

function FilterLink({ value, onClick, className = '' }) {
  if (!value) return <span className="text-stone-300">—</span>;
  return (
    <button
      onClick={() => onClick(value)}
      className={`text-left hover:underline transition-colors ${className}`}
    >
      {value}
    </button>
  );
}

// ── Mobile transaction card ───────────────────────────────────────────────────

// Unified card for both mobile and desktop (no table layout)
function TransactionCard({ tx, onFilterCategory, onFilterBudget, onFilterBill, onFilterTag, onFilterDestination }) {
  const split      = tx.attributes?.transactions?.[0] || {};
  const type       = txType(split);
  const isExpense  = type === 'expense';
  const isTransfer = type === 'transfer';
  const tags       = split.tags || [];
  const reconciled = split.reconciled === true;
  const isSplit    = tx._isSplit === true;
  const groupTitle = tx._groupTitle;

  const source      = split.source_name;
  const destination = split.destination_name;
  const flowArrow   = isTransfer ? '⇄' : '→';

  const amountColor = isExpense ? 'text-red-600' : isTransfer ? 'text-indigo-600' : 'text-emerald-700';
  const typeLabel   = isExpense ? 'Expense' : isTransfer ? 'Transfer' : 'Income';
  const dateLabel   = split.date ? fmtDateShort(split.date) : null;

  const description = split.description || '—';
  // For splits, show the group title as context above if it differs from the split description
  const showGroupTitle = isSplit && groupTitle && groupTitle !== description;

  return (
    <div className={`border-b border-stone-100 px-4 py-3 hover:bg-stone-50 transition-colors${isSplit ? ' border-l-2 border-l-stone-200' : ''}`}>
      {showGroupTitle && (
        <p className="text-xs text-stone-400 mb-0.5 truncate">{groupTitle}</p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-1 min-w-0 pt-0.5">
          <p className="text-sm text-stone-800 font-medium leading-snug">{description}</p>
          {reconciled && (
            <span title="Reconciled" className="shrink-0 inline-flex items-center justify-center text-emerald-600" style={{fontSize:13, lineHeight:1}}>✓</span>
          )}
          {dateLabel && <span className="text-xs text-stone-400 whitespace-nowrap shrink-0">{dateLabel}</span>}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-semibold tabular-nums ${amountColor}`}>
            {isExpense ? '−' : isTransfer ? '⇄' : '+'} {fmt(split.amount, split.currency_symbol)}
          </p>
          <p className={`text-xs uppercase tracking-wide mt-0.5 ${amountColor}`} style={{opacity:0.7}}>{typeLabel}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {(source || destination) && (
          <span className="inline-flex items-center gap-1">
            {source      && <button onClick={() => onFilterDestination(source)}      className={CHIP.account}>{source}</button>}
            {source && destination && <span className={CHIP.accountArrow}>{flowArrow}</span>}
            {destination && <button onClick={() => onFilterDestination(destination)} className={CHIP.account}>{destination}</button>}
          </span>
        )}
        {split.budget_name   && <button onClick={() => onFilterBudget(split.budget_name)}     className={CHIP.budget}>{split.budget_name}</button>}
        {split.bill_name     && <BillChip name={split.bill_name} onClick={() => onFilterBill(split.bill_name)} />}
        {split.category_name && <button onClick={() => onFilterCategory(split.category_name)} className={CHIP.cat}>{split.category_name}</button>}
        {tags.map(tag => <button key={tag} onClick={() => onFilterTag(tag)} className={CHIP.tag}><TagDot />{tag}</button>)}
      </div>
    </div>
  );
}

// Alias — desktop now uses the same card layout
const TransactionRow = TransactionCard;

// ── Date group ────────────────────────────────────────────────────────────────

function DateGroup({ date, transactions, onFilterCategory, onFilterBudget, onFilterBill, onFilterTag, onFilterDestination }) {
  return (
    <>
      {transactions.map(tx => (
        <TransactionCard key={tx.id} tx={tx}
          onFilterCategory={onFilterCategory} onFilterBudget={onFilterBudget}
          onFilterBill={onFilterBill} onFilterTag={onFilterTag} onFilterDestination={onFilterDestination} />
      ))}
    </>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({ account, mobile, isActive, onClick }) {
  const attr    = account.attributes;
  const balance = parseFloat(attr.current_balance);

  if (mobile) {
    return (
      <button onClick={onClick} className={`w-full flex items-center justify-between px-4 py-3 border-b border-stone-100 text-left hover:bg-stone-50 transition-colors ${isActive ? 'bg-stone-50' : ''}`}>
        <div>
          <p className={`text-sm font-medium ${isActive ? 'font-semibold text-stone-800' : 'text-stone-800'}`}>{attr.name}</p>
          <p className="text-xs text-stone-400 mt-0.5">{attr.account_number || attr.type}</p>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          {fmt(attr.current_balance, attr.currency_symbol)}
        </span>
      </button>
    );
  }

  return (
    <tr onClick={onClick} className={`border-b border-stone-100 hover:bg-stone-50 cursor-pointer transition-colors ${isActive ? 'bg-stone-50' : ''}`}>
      <td className={`py-2.5 pl-4 pr-4 text-sm ${isActive ? 'font-semibold text-stone-800' : 'text-stone-800 font-medium'}`}>{attr.name}</td>
      <td className="py-2.5 pr-4 text-xs text-stone-400 uppercase tracking-wide">{attr.type}</td>
      <td className="py-2.5 pr-4 text-sm text-stone-400 font-mono">{attr.account_number || '—'}</td>
      <td className={`py-2.5 pr-4 text-sm font-semibold text-right tabular-nums
        ${balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
        {fmt(attr.current_balance, attr.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Piggy bank row ────────────────────────────────────────────────────────────



// ── Account balance over time (line chart) ────────────────────────────────────

const ACCOUNT_COLORS = [
  '#0D9488', '#378ADD', '#BA7517', '#7F77DD',
  '#D4537E', '#639922', '#D85A30', '#888780',
];

function AccountLineChart({ transactions, accounts }) {
  const [selected, setSelected] = useState(null);

  const { series, dateLabels } = useMemo(() => {
    const splits = [];
    for (const tx of transactions) {
      const sp = tx.attributes?.transactions?.[0] || {};
      if (!sp.source_name || sp.source_balance_after == null) continue;
      splits.push({ date: (sp.date || '').slice(0, 10), account: sp.source_name, balance: parseFloat(sp.source_balance_after) });
      if (sp.destination_balance_after != null && sp.destination_name)
        splits.push({ date: (sp.date || '').slice(0, 10), account: sp.destination_name, balance: parseFloat(sp.destination_balance_after) });
    }
    splits.sort((a, b) => a.date.localeCompare(b.date));
    const dateSet = [...new Set(splits.map(s => s.date))].sort();
    if (dateSet.length < 2) return { series: [], dateLabels: [] };
    const accountMap = {};
    for (const { date, account, balance } of splits) {
      if (!accountMap[account]) accountMap[account] = {};
      accountMap[account][date] = balance;
    }
    const EXCLUDED = new Set(['comdirect savings account', 'Leaseplan Bank', 'Scalable.capital']);
    const assetNames = new Set((accounts || []).map(a => a.attributes?.name).filter(Boolean));
    const series = Object.keys(accountMap)
      .filter(name => assetNames.has(name) && !EXCLUDED.has(name))
      .map((name, i) => {
        // Forward-fill
        let last = null;
        const values = dateSet.map(d => {
          if (accountMap[name][d] !== undefined) last = accountMap[name][d];
          return last;
        });
        // Back-fill: propagate the earliest known value to the start
        const firstKnown = values.find(v => v !== null);
        if (firstKnown !== null && firstKnown !== undefined) {
          let filling = true;
          for (let i = 0; i < values.length; i++) {
            if (filling && values[i] === null) values[i] = firstKnown;
            else filling = false;
          }
        }
        return { name, values, color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] };
      });
    return { series, dateLabels: dateSet };
  }, [transactions, accounts]);

  if (series.length === 0) return null;

  const W = 600, H = 120, PAD = { t: 8, r: 80, b: 22, l: 44 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const allValues = series.flatMap(s => s.values.filter(v => v !== null));
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  const xOf = i => PAD.l + (i / (dateLabels.length - 1)) * innerW;
  const yOf = v => PAD.t + innerH - ((v - minV) / range) * innerH;

  const fmtY = v => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return Math.round(v).toString();
  };

  const yTicks = [minV, minV + range * 0.5, maxV];
  const step = Math.max(1, Math.floor((dateLabels.length - 1) / 3));
  const xTickIdxs = [];
  for (let i = 0; i < dateLabels.length; i += step) xTickIdxs.push(i);
  if (xTickIdxs[xTickIdxs.length - 1] !== dateLabels.length - 1) xTickIdxs.push(dateLabels.length - 1);

  const toggle = name => setSelected(s => s === name ? null : name);
  const hasSelection = selected !== null;

  // For selected line: find min, max, last values to annotate
  const selectedSeries = series.find(s => s.name === selected);
  const symbol = accounts?.[0]?.attributes?.currency_symbol || '€';

  return (
    <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden mb-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
        aria-label="Account balances over time"
      >
        {/* Y grid lines */}
        {yTicks.map((v, i) => (
          <line key={i} x1={PAD.l} y1={yOf(v)} x2={PAD.l + innerW} y2={yOf(v)} stroke="#e7e5e4" strokeWidth="0.5" />
        ))}
        {/* Zero line */}
        {minV < 0 && maxV > 0 && (
          <line x1={PAD.l} y1={yOf(0)} x2={PAD.l + innerW} y2={yOf(0)} stroke="#a8a29e" strokeWidth="0.8" strokeDasharray="3 2" />
        )}
        {/* Y axis labels */}
        {yTicks.map((v, i) => (
          <text key={i} x={PAD.l - 4} y={yOf(v) + 3.5} textAnchor="end" fontSize="8" fill="#a8a29e">{fmtY(v)}</text>
        ))}
        {/* X axis labels */}
        {xTickIdxs.map(i => (
          <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="#a8a29e">{dateLabels[i].slice(5).replace('-', '.')}</text>
        ))}
        {/* Lines — unselected drawn first (behind) */}
        {series.filter(s => s.name !== selected).map(({ name, values, color }) => {
          const pts = values.map((v, i) => v !== null ? `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}` : null).filter(Boolean);
          if (pts.length < 2) return null;
          return (
            <polyline key={name} points={pts.join(' ')} fill="none"
              stroke={color} strokeWidth={hasSelection ? 1 : 1.5}
              opacity={hasSelection ? 0.18 : 1}
              strokeLinejoin="round" strokeLinecap="round"
              style={{ cursor: 'pointer' }}
              onClick={() => toggle(name)}
            />
          );
        })}
        {/* Selected line drawn on top */}
        {selectedSeries && (() => {
          const { name, values, color } = selectedSeries;
          const pts = values.map((v, i) => v !== null ? `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}` : null).filter(Boolean);
          if (pts.length < 2) return null;
          const lastIdx = values.length - 1;
          const lastV = values[lastIdx];
          const nonNull = values.filter(v => v !== null);
          const peakV = Math.max(...nonNull);
          const troughV = Math.min(...nonNull);
          const peakIdx = values.lastIndexOf(peakV);
          const troughIdx = values.lastIndexOf(troughV);
          return (
            <g key={name} onClick={() => toggle(name)} style={{ cursor: 'pointer' }}>
              <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2.2"
                strokeLinejoin="round" strokeLinecap="round" />
              {/* last balance label */}
              {lastV !== null && (
                <>
                  <circle cx={xOf(lastIdx)} cy={yOf(lastV)} r="3" fill={color} stroke="white" strokeWidth="1.5" />
                  <text x={xOf(lastIdx) + 6} y={yOf(lastV) + 3.5} fontSize="8.5" fill={color} fontWeight="500">{fmtY(lastV)}</text>
                </>
              )}
              {/* peak label (only if meaningfully different from last) */}
              {peakIdx !== lastIdx && Math.abs(peakV - lastV) / (range || 1) > 0.08 && (
                <>
                  <circle cx={xOf(peakIdx)} cy={yOf(peakV)} r="2" fill={color} stroke="white" strokeWidth="1" />
                  <text x={xOf(peakIdx)} y={yOf(peakV) - 4} fontSize="8" fill={color} textAnchor="middle" opacity="0.8">{fmtY(peakV)}</text>
                </>
              )}
              {/* trough label (only if negative or meaningfully different) */}
              {troughIdx !== lastIdx && troughIdx !== peakIdx && Math.abs(troughV - lastV) / (range || 1) > 0.08 && (
                <>
                  <circle cx={xOf(troughIdx)} cy={yOf(troughV)} r="2" fill={color} stroke="white" strokeWidth="1" />
                  <text x={xOf(troughIdx)} y={yOf(troughV) + 11} fontSize="8" fill={color} textAnchor="middle" opacity="0.8">{fmtY(troughV)}</text>
                </>
              )}
            </g>
          );
        })()}
        {/* Unselected end dots */}
        {!hasSelection && series.map(({ name, values, color }) => {
          const lastIdx = values.length - 1;
          const v = values[lastIdx];
          if (v === null) return null;
          return <circle key={name} cx={xOf(lastIdx)} cy={yOf(v)} r="2.5" fill={color} stroke="white" strokeWidth="1" />;
        })}
      </svg>
      {/* Legend — clickable */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1">
        {series.map(({ name, color }) => {
          const isSel = selected === name;
          const faded = hasSelection && !isSel;
          return (
            <button key={name} onClick={() => toggle(name)}
              className="inline-flex items-center gap-1.5 text-xs transition-opacity"
              style={{ opacity: faded ? 0.3 : 1, color: isSel ? color : '#78716c', fontWeight: isSel ? 500 : 400 }}>
              <span style={{ width: isSel ? 14 : 10, height: isSel ? 2.5 : 2, background: color, display: 'inline-block', borderRadius: 1, transition: 'all 0.15s' }} />
              {name}
            </button>
          );
        })}
        {hasSelection && (
          <button onClick={() => setSelected(null)} className="text-xs text-stone-300 hover:text-stone-500 transition-colors ml-1">
            clear
          </button>
        )}
      </div>
    </div>
  );
}

const HPF_NAME = 'Home Purchase Fund';
const HPF_COLOR = '#0D9488';
const HPF_COLOR_LIGHT = '#CCFBF1';
const HPF_COLOR_MID = '#5EEAD4';
const HPF_COLOR_DARK = '#0F766E';

function HomePurchaseIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      {/* sky */}
      <rect x="0" y="0" width="36" height="36" rx="8" fill={HPF_COLOR_LIGHT} />
      {/* sea waves */}
      <path d="M0 26 Q4 23 8 25 Q12 27 16 24 Q20 21 24 23 Q28 25 32 22 Q34 21 36 22 L36 36 L0 36 Z" fill={HPF_COLOR_MID} />
      <path d="M0 29 Q5 27 9 28.5 Q14 30 18 28 Q23 26 27 27.5 Q31 29 36 27 L36 36 L0 36 Z" fill={HPF_COLOR} />
      {/* house body */}
      <rect x="11" y="18" width="14" height="10" rx="1" fill="white" opacity="0.9" />
      {/* door */}
      <rect x="15" y="22" width="4" height="6" rx="0.5" fill={HPF_COLOR_DARK} opacity="0.5" />
      {/* window */}
      <rect x="12.5" y="19.5" width="3" height="2.5" rx="0.5" fill={HPF_COLOR_MID} opacity="0.7" />
      {/* roof */}
      <path d="M9 18.5 L18 10 L27 18.5" fill={HPF_COLOR_DARK} />
    </svg>
  );
}

function PiggyBankRow({ bank }) {
  const attr = bank.attributes || {};
  const current = parseFloat(attr.current_amount || 0);
  const target  = parseFloat(attr.target_amount  || 0);
  const symbol  = attr.currency_symbol || '€';
  const pct     = target > 0 ? Math.min(100, Math.round(current / target * 100)) : null;
  const done    = target > 0 && current >= target;
  const isHPF   = attr.name === HPF_NAME;

  const barColor = isHPF
    ? HPF_COLOR
    : done ? '#1D9E75' : pct !== null && pct < 30 ? '#BA7517' : '#378ADD';

  if (isHPF) {
    return (
      <div className="flex items-center gap-4 px-4 py-3 border-b border-stone-100 last:border-0"
        style={{ background: '#F0FDFA' }}>
        <HomePurchaseIcon />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: HPF_COLOR_DARK }}>{attr.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: HPF_COLOR_LIGHT }}>
              <div
                className="h-2 rounded-full transition-all"
                style={{ width: `${pct ?? 0}%`, background: HPF_COLOR }}
              />
            </div>
            {pct !== null && (
              <span className="text-xs tabular-nums shrink-0 w-8 text-right font-medium" style={{ color: HPF_COLOR_DARK }}>{pct}%</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums" style={{ color: HPF_COLOR_DARK }}>{fmt(current, symbol)}</p>
          {target > 0 && (
            <p className="text-xs mt-0.5" style={{ color: HPF_COLOR }}>{`of ${fmt(target, symbol)}`}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-stone-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{attr.name}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{ width: `${pct ?? 0}%`, background: barColor }}
            />
          </div>
          {pct !== null && (
            <span className="text-xs text-stone-400 tabular-nums shrink-0 w-8 text-right">{pct}%</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums text-stone-700">{fmt(current, symbol)}</p>
        {target > 0 && (
          <p className="text-xs text-stone-400 mt-0.5">of {fmt(target, symbol)}</p>
        )}
      </div>
    </div>
  );
}

// ── Budget × Category pie chart (pure SVG, no external deps) ─────────────────

const CAT_COLORS = [
  '#378ADD', '#1D9E75', '#BA7517', '#D85A30',
  '#7F77DD', '#888780', '#D4537E', '#639922',
];

// Compute SVG arc path for a pie slice given start/end angles (radians)
function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function BudgetCategoryChart({ transactions, budgets, filterBudget, onSelectBudget, onSelectCategory }) {
  const [chartBudget, setChartBudget] = useState(filterBudget || null);
  const [hovered, setHovered] = useState(null);

  // Sync selector when external filterBudget changes
  useEffect(() => {
    if (filterBudget) setChartBudget(filterBudget);
  }, [filterBudget]);

  const { slices, total, budgetSpent } = useMemo(() => {
    const map = {};
    transactions.forEach(tx => {
      const split = tx.attributes?.transactions?.[0] || {};
      if (split.type !== 'withdrawal') return;
      if (chartBudget && split.budget_name !== chartBudget) return;
      const cat = split.category_name || 'Uncategorized';
      map[cat] = (map[cat] || 0) + parseFloat(split.amount || 0);
    });
    const entries = Object.entries(map).sort(([, a], [, b]) => b - a);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const bObj = budgets.find(b => (b.attributes?.name || '') === chartBudget);
    const budgetSpent = bObj?.spent ?? null;
    return { slices: entries, total, budgetSpent };
  }, [transactions, budgets, chartBudget]);

  // Build pie slice paths
  const cx = 90, cy = 90, r = 82;
  let cursor = -Math.PI / 2; // start at top
  const paths = slices.map(([cat, val], i) => {
    const angle = total > 0 ? (val / total) * 2 * Math.PI : 0;
    const startAngle = cursor;
    const endAngle = cursor + angle;
    cursor = endAngle;
    return { cat, val, color: CAT_COLORS[i % CAT_COLORS.length], startAngle, endAngle, i };
  });

  return (
    <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
      {/* Budget selector */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
        <span className="text-xs text-stone-400 uppercase tracking-wide shrink-0">Budget</span>
        <select
          value={chartBudget || ''}
          onChange={e => {
            const v = e.target.value || null;
            setChartBudget(v);
            if (v) onSelectBudget(v);
          }}
          className="text-sm text-stone-700 bg-transparent border-0 outline-none cursor-pointer flex-1 min-w-0"
        >
          <option value="">All budgets</option>
          {budgets.map(b => {
            const name = b.attributes?.name || '—';
            return <option key={b.id} value={name}>{name}</option>;
          })}
        </select>
        {chartBudget && budgetSpent !== null && (
          <span className="text-xs tabular-nums text-stone-400 shrink-0">
            {fmt(budgetSpent)} spent
          </span>
        )}
      </div>

      {slices.length === 0 ? (
        <p className="py-8 text-center text-stone-300 text-sm">No category data for this budget.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-start">
          {/* SVG pie */}
          <div className="w-full sm:w-48 shrink-0 p-4 flex items-center justify-center">
            <svg viewBox="0 0 180 180" width="180" height="180">
              {paths.map(({ cat, val, color, startAngle, endAngle, i }) => (
                <path
                  key={cat}
                  d={pieSlicePath(cx, cy, hovered === i ? r + 4 : r, startAngle, endAngle)}
                  fill={color}
                  stroke="#fff"
                  strokeWidth="2"
                  style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onSelectCategory(cat)}
                />
              ))}
              {/* Center label on hover */}
              {hovered !== null && paths[hovered] && (
                <>
                  <text x={cx} y={cy - 8} textAnchor="middle" fontSize="11" fill="#78716c">
                    {paths[hovered].cat}
                  </text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fontSize="13" fontWeight="500" fill="#292524">
                    {fmt(paths[hovered].val)}
                  </text>
                  <text x={cx} y={cy + 26} textAnchor="middle" fontSize="11" fill="#a8a29e">
                    {total > 0 ? Math.round(paths[hovered].val / total * 100) : 0}%
                  </text>
                </>
              )}
            </svg>
          </div>

          {/* Legend / category list */}
          <div className="flex-1 w-full divide-y divide-stone-100">
            {slices.map(([cat, spent], i) => {
              const pct = total > 0 ? Math.round(spent / total * 100) : 0;
              return (
                <button
                  key={cat}
                  onClick={() => onSelectCategory(cat)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors text-left ${hovered === i ? 'bg-stone-50' : ''}`}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                  <span className="text-sm text-stone-600 flex-1 truncate">{cat}</span>
                  <span className="text-xs text-stone-400 tabular-nums shrink-0 w-8 text-right">{pct}%</span>
                  <span className="text-sm tabular-nums text-red-600 shrink-0 w-20 text-right">− {fmt(spent)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashboardPage({ user, onLogout }) {
  const [accounts,      setAccounts]      = useState([]);
  const [budgets,       setBudgets]       = useState([]);
  const [bills,         setBills]         = useState([]);
  const [piggyBanks,    setPiggyBanks]    = useState([]);
  const [transactions,  setTransactions]  = useState([]);
  const [budgetPeriods, setBudgetPeriods] = useState([]);
  const [loadingTx,       setLoadingTx]       = useState(true);
  const [loadingMeta,     setLoadingMeta]     = useState(true);
  const [loadingBudgets,  setLoadingBudgets]  = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingBills,    setLoadingBills]    = useState(true);
  const [loadingPiggies,  setLoadingPiggies]  = useState(true);
  const [error,         setError]         = useState('');
  const bottomRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const loading = loadingTx;

  const [customStart,  setCustomStart]  = useState('');
  const [customEnd,    setCustomEnd]    = useState('');
  const [pickerOpen,   setPickerOpen]   = useState(false);
  const pickerRef = useRef(null);

  const activeDateRange = useMemo(() => {
    if (customStart && customEnd)
      return { start: customStart, end: customEnd, label: `${fmtDatePeriod(customStart)} – ${fmtDatePeriod(customEnd)}` };
    return null;
  }, [customStart, customEnd]);

  const [filterCategory,   setFilterCategory]   = useState(null);
  const [filterBudget,     setFilterBudget]      = useState(null);
  const [filterBill,       setFilterBill]        = useState(null);
  const [filterTag,        setFilterTag]         = useState(null);
  const [filterTypes,      setFilterTypes]       = useState(new Set(['expense', 'income'])); // set of 'expense'|'income'|'transfer'
  const [filterDestination,setFilterDestination] = useState(null);
  const [page,             setPage]              = useState(1);
  const [accountsOpen,    setAccountsOpen]      = useState(false);
  const [categoriesOpen,   setCategoriesOpen]   = useState(false);
  const [billsOpen,        setBillsOpen]        = useState(false);
  const [tagsOpen,         setTagsOpen]         = useState(false);
  const [piggyBanksOpen,   setPiggyBanksOpen]   = useState(false);
  const [visionOpen,       setVisionOpen]       = useState(false);
  const [visionText,       setVisionText]       = useState(() => { try { return localStorage.getItem('moverview_vision') || ''; } catch { return ''; } });

  // Detect mobile (< 768px) — re-checked on resize
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Show scroll-to-bottom button when transactions section is in view
  useEffect(() => {
    const txSection = document.getElementById('transactions-section');
    if (!txSection) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollBtn(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(txSection);
    return () => observer.disconnect();
  }, [loadingTx]);

  // On mount: immediately set current month so transactions load right away.
  // Budget spent amounts load in the background via the date-range effect.
  useEffect(() => {
    const now  = new Date();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    setCustomStart(`${y}-${m}-01`);
    setCustomEnd(`${y}-${m}-${String(last).padStart(2, '0')}`);
  }, []);

  useEffect(() => {
    if (!activeDateRange) return;
    const { start, end } = activeDateRange;

    // Reset
    setTransactions([]);
    setPage(1);
    setLoadingTx(true);
    setLoadingMeta(true);
    setLoadingBudgets(true);
    setLoadingAccounts(true);
    setLoadingBills(true);
    setLoadingPiggies(true);

    // 1. Transactions first — show immediately when ready
    firefly.transactions(start, end)
      .then(txData => setTransactions(dedupe(txData)))
      .catch(err => setError(err.message))
      .finally(() => setLoadingTx(false));

    // 2. Accounts — background
    firefly.accounts('asset')
      .then(res => setAccounts(res.data || []))
      .catch(() => {})
      .finally(() => setLoadingAccounts(false));

    // 3. Budgets — name-list renders immediately, amounts fill in per-budget
    firefly.budgetsAndPeriods(start, end, {
      onBudgetsReady: (list) => {
        // Seed with name-only entries so pills are laid out right away
        setBudgets(list.map(b => ({ ...b, spent: null })));
      },
      onBudgetResolved: (b) => {
        setBudgets(prev => prev.map(p => p.id === b.id ? b : p));
        setLoadingBudgets(prev => {
          // Clear spinner once every budget has a real spent value (not null)
          // We check after this update so use a timeout trick via setState callback
          return prev;
        });
      },
    }).then(({ periods }) => {
      setLoadingBudgets(false);
      setBudgetPeriods(prev => {
        const existing = new Set(prev.map(p => `${p.start}|${p.end}`));
        const merged   = [...prev];
        periods.forEach(p => { if (!existing.has(`${p.start}|${p.end}`)) merged.push(p); });
        return merged.sort((a, b) => b.start.localeCompare(a.start));
      });
    }).catch(() => { setLoadingBudgets(false); });

    // 4. Bills — background
    firefly.bills()
      .then(setBills)
      .catch(() => {})
      .finally(() => { setLoadingBills(false); setLoadingMeta(false); });

    // 5. Piggy banks — background, no date dependency
    firefly.piggyBanks()
      .then(setPiggyBanks)
      .catch(() => {})
      .finally(() => setLoadingPiggies(false));

  }, [activeDateRange]);


  function dedupe(txs) {
    const seen = new Set();
    return txs
      .filter(tx => { if (seen.has(tx.id)) return false; seen.add(tx.id); return true; })
      .sort((a, b) => {
        const da = new Date(a.attributes?.transactions?.[0]?.date || 0);
        const db = new Date(b.attributes?.transactions?.[0]?.date || 0);
        return db - da;
      });
  }

  function applyFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  function clearAll() {
    setFilterCategory(null); setFilterBudget(null); setFilterBill(null);
    setFilterTag(null); setFilterTypes(new Set(['expense', 'income'])); setFilterDestination(null);
    setPage(1);
  }

  const filtered = useMemo(() => transactions.filter(tx => {
    const split = tx.attributes?.transactions?.[0] || {};
    const type  = txType(split);
    if (filterTypes.size  && !filterTypes.has(type))                               return false;
    if (filterCategory    && split.category_name !== filterCategory)               return false;
    if (filterBudget      && split.budget_name   !== filterBudget)                 return false;
    if (filterBill        && split.bill_name     !== filterBill)                   return false;
    if (filterTag         && !(split.tags || []).includes(filterTag))              return false;
    if (filterDestination && split.source_name !== filterDestination && split.destination_name !== filterDestination) return false;
    return true;
  }), [transactions, filterTypes, filterCategory, filterBudget, filterBill, filterTag, filterDestination]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageStart  = (page - 1) * PAGE_SIZE;
  const pageTxs    = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const pageGroups = groupByDate(pageTxs);

  const hasFilters = filterCategory || filterBudget || filterBill || filterTag || filterTypes.size || filterDestination;

  const filteredSummary = useMemo(() => {
    let income = 0, expense = 0;
    filtered.forEach(tx => {
      const split = tx.attributes?.transactions?.[0] || {};
      const type  = txType(split);
      const amount = parseFloat(split.amount || 0);
      if (type === 'income')  income  += amount;
      if (type === 'expense') expense += amount;
    });
    return { income, expense, net: income - expense };
  }, [filtered]);

  // Derive category/tag summaries from ALL loaded transactions (not filtered)
  const categorySummary = useMemo(() => {
    const map = {};
    transactions.forEach(tx => {
      const split = tx.attributes?.transactions?.[0] || {};
      if (split.type !== 'withdrawal') return;
      const cat = split.category_name || 'Uncategorized';
      map[cat] = (map[cat] || 0) + parseFloat(split.amount || 0);
    });
    return Object.entries(map).sort(([,a],[,b]) => b - a);
  }, [transactions]);

  const tagSummary = useMemo(() => {
    const map = {};
    transactions.forEach(tx => {
      const split = tx.attributes?.transactions?.[0] || {};
      (split.tags || []).forEach(tag => {
        map[tag] = (map[tag] || 0) + parseFloat(split.amount || 0);
      });
    });
    return Object.entries(map).sort(([,a],[,b]) => b - a);
  }, [transactions]);

  const periodSummary = useMemo(() => {
    let income = 0, expense = 0, transfer = 0;
    transactions.forEach(tx => {
      const split  = tx.attributes?.transactions?.[0] || {};
      const type   = txType(split);
      const amount = parseFloat(split.amount || 0);
      if (type === 'income')   income   += amount;
      if (type === 'expense')  expense  += amount;
      if (type === 'transfer') transfer += amount;
    });
    return { income, expense, transfer, net: income - expense };
  }, [transactions]);

  const handlers = {
    onFilterCategory:    v => applyFilter(setFilterCategory, v),
    onFilterBudget:      v => applyFilter(setFilterBudget, v),
    onFilterBill:        v => applyFilter(setFilterBill, v),
    onFilterTag:         v => applyFilter(setFilterTag, v),
    onFilterDestination: v => applyFilter(setFilterDestination, v),
  };


  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">

      {/* Nav */}
      <header className="bg-white border-b border-stone-200 px-4 py-3 flex items-center sticky top-0 z-10" style={{position:'sticky'}}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <img src="/icon.svg" alt="MOverview" className="w-7 h-7 shrink-0" /><span className="text-stone-800 font-semibold tracking-tight shrink-0">MOverview</span>
          <span className="text-stone-300 shrink-0">·</span>
          <span className="text-sm text-stone-400 truncate">
            {loadingTx ? 'Loading transactions…' : `${transactions.length} transactions`}
            {!loadingTx && filtered.length !== transactions.length && ` · ${filtered.length} shown`}
          </span>
          {(!loadingTx && loadingMeta) && (
            <span className="animate-spin shrink-0" style={{
              width: 12, height: 12,
              border: '1.5px solid #d6d3d1',
              borderTopColor: '#78716c',
              borderRadius: '50%',
              display: 'inline-block',
            }} />
          )}
        </div>
        <span className="text-xs text-stone-300 hidden sm:inline" style={{position:'absolute',left:'50%',transform:'translateX(-50%)'}}>{__APP_VERSION__}</span>
        <div className="flex items-center justify-end flex-1"><button onClick={onLogout} className="text-sm text-stone-400 hover:text-stone-700 transition-colors shrink-0">
          Sign out
        </button></div>
      </header>

      <main className="mx-auto max-w-6xl px-0 sm:px-4 py-6 space-y-6">

        {error && (
          <div className="mx-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-stone-400 text-sm py-12 text-center">Loading transactions…</p>
        ) : (
          <>
            {/* ── Budget strip ── */}
            {!loading && (
              <section className="px-4 sm:px-0">
                {/* Date picker */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-stone-200" />
                  <div className="relative" ref={pickerRef}>
                    <button
                      onClick={() => setPickerOpen(o => !o)}
                      className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 bg-white border border-stone-400 rounded px-3 py-1.5 hover:border-stone-600 transition-colors whitespace-nowrap"
                    >
                      <span>📅</span>
                      {activeDateRange ? activeDateRange.label : 'Loading periods…'}
                      <span className="text-stone-400 text-xs">{pickerOpen ? '▲' : '▼'}</span>
                    </button>
                    {pickerOpen && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-stone-200 rounded-lg shadow-lg z-50 min-w-[240px] overflow-hidden">
                        {budgetPeriods.length > 0 ? (
                          <>
                            <div className="px-4 py-2 bg-stone-50 border-b border-stone-100">
                              <p className="text-xs text-stone-400 uppercase tracking-wide">Budget periods</p>
                            </div>
                            {budgetPeriods.map(p => {
                              const label = `${fmtDatePeriod(p.start)} – ${fmtDatePeriod(p.end)}`;
                              const key = `${p.start}|${p.end}`;
                              const isActive = customStart === p.start && customEnd === p.end;
                              return (
                                <button key={key}
                                  onClick={() => { setCustomStart(p.start); setCustomEnd(p.end); setPickerOpen(false); }}
                                  className={`w-full text-left px-4 py-2.5 text-sm border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors
                                    ${isActive ? 'font-semibold text-stone-800 bg-stone-50' : 'text-stone-600'}`}>
                                  {label}
                                </button>
                              );
                            })}
                          </>
                        ) : (
                          <p className="px-4 py-3 text-sm text-stone-400">No budget periods found.</p>
                        )}
                        {/* Custom range */}
                        <div className="px-4 py-3 border-t border-stone-100">
                          <p className="text-xs text-stone-400 uppercase tracking-wide mb-2">Custom range</p>
                          <div className="flex flex-col gap-2">
                            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                              className="text-xs border border-stone-200 rounded px-2 py-1 text-stone-600 w-full" />
                            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                              className="text-xs border border-stone-200 rounded px-2 py-1 text-stone-600 w-full" />
                            <button
                              disabled={!customStart || !customEnd}
                              onClick={() => { setPickerOpen(false); }}
                              className="text-xs bg-stone-800 text-white rounded px-3 py-1.5 hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 h-px bg-stone-200" />
                </div>
                {/* Period summary — clickable type filters */}
                {transactions.length > 0 && (
                  <div className="flex rounded-lg border border-stone-200 bg-white overflow-hidden mb-4">
                    {[
                      { key: 'income',   label: 'Income',    value: `+ ${fmt(periodSummary.income)}`,              color: 'text-emerald-600' },
                      { key: 'expense',  label: 'Expenses',  value: `− ${fmt(periodSummary.expense)}`,             color: 'text-red-600' },
                      { key: 'transfer', label: 'Transfers', value: `⇄ ${fmt(periodSummary.transfer)}`,            color: 'text-indigo-600' },
                      { key: null,       label: 'Net',       value: `${periodSummary.net >= 0 ? '+' : '−'} ${fmt(Math.abs(periodSummary.net))}`, color: periodSummary.net >= 0 ? 'text-emerald-600' : 'text-red-600' },
                    ].map((item, i, arr) => {
                      const isActive = item.key !== null && filterTypes.has(item.key);
                      return (
                        <button key={item.label}
                          onClick={() => {
                            if (!item.key) return;
                            setFilterTypes(prev => {
                              const next = new Set(prev);
                              next.has(item.key) ? next.delete(item.key) : next.add(item.key);
                              return next;
                            });
                            setPage(1);
                          }}
                          className={`flex-1 px-3 py-3 text-left transition-colors ${i < arr.length - 1 ? 'border-r border-stone-100' : ''}
                            ${isActive ? 'bg-stone-50' : item.key ? 'hover:bg-stone-50 cursor-pointer' : 'cursor-default'}`}>
                          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">{item.label}</p>
                          <p className={`text-sm font-bold tabular-nums ${isActive ? item.color : item.color}`}>{item.value}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                {transactions.length > 0 && (
                  <AccountLineChart transactions={transactions} accounts={accounts} />
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400">Budgets</h2>
                    {loadingBudgets && <SectionSpinner label="loading amounts…" />}
                  </div>
                  <button
                    onClick={() => setVisionOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors"
                    style={{ fontSize: 11 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M0 9 Q1.5 6.5 3 7.5 Q4.5 8.5 6.5 6 Q8.5 3.5 10 5.5 Q11.5 7.5 13 6 L13 13 L0 13Z" fill="#5DCAA5" opacity="0.6"/>
                      <path d="M0 11 Q2 9 4 10 Q6.5 11 9 9.5 Q11 8.5 13 9.5 L13 13 L0 13Z" fill="#1D9E75" opacity="0.7"/>
                      <circle cx="9.5" cy="3" r="2" fill="#9FE1CB" opacity="0.6"/>
                      <circle cx="11" cy="1.5" r="1.2" fill="#9FE1CB" opacity="0.4"/>
                    </svg>
                    Future Vision
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {budgets.map(b => {
                    const name = b.attributes?.name || '—';
                    const spent = b.spent;  // null = still loading, 0+ = resolved
                    const isActive = filterBudget === name;
                    return (
                      <button key={b.id} onClick={() => applyFilter(setFilterBudget, isActive ? null : name)}
                        className={`flex items-center gap-2 text-sm px-4 py-1.5 rounded-full border transition-colors
                          ${isActive
                            ? 'bg-stone-800 border-stone-800 text-white'
                            : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'}`}>
                        <span>{name}</span>
                        {spent === null
                          ? <span className="animate-spin" style={{width:9,height:9,flexShrink:0,border:'1.5px solid #d6d3d1',borderTopColor:'#292524',borderRadius:'50%',display:'inline-block'}} />
                          : spent > 0 && (
                            <span className={`text-xs tabular-nums ${isActive ? 'text-stone-300' : 'text-stone-400'}`}>
                              {fmt(spent)}
                            </span>
                          )
                        }
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Active filters ── */}
            {hasFilters && (
              <div className="flex items-center gap-2 flex-wrap px-4">
                <span className="text-xs text-stone-400 uppercase tracking-wide shrink-0">Filter:</span>
                {filterCategory    && <FilterPill label={filterCategory}    onClear={() => applyFilter(setFilterCategory, null)} />}
                {filterBudget      && <FilterPill label={filterBudget}      onClear={() => applyFilter(setFilterBudget, null)} />}
                {filterBill        && <FilterPill label={filterBill}        onClear={() => applyFilter(setFilterBill, null)} />}
                {[...filterTypes].map(t => (
                  <FilterPill key={t} label={t} onClear={() => { setFilterTypes(prev => { const n = new Set(prev); n.delete(t); return n; }); setPage(1); }} />
                ))}
                {filterTag         && <FilterPill label={filterTag}         onClear={() => applyFilter(setFilterTag, null)} />}
                {filterDestination && <FilterPill label={`Account: ${filterDestination}`} onClear={() => applyFilter(setFilterDestination, null)} />}
                <button onClick={clearAll} className="text-xs text-stone-400 hover:text-stone-700 underline">
                  Clear all
                </button>
                <span className="ml-auto flex items-center gap-3 shrink-0">
                  {filteredSummary.income > 0 && (
                    <span className="text-xs tabular-nums text-emerald-700">+ {fmt(filteredSummary.income)}</span>
                  )}
                  {filteredSummary.expense > 0 && (
                    <span className="text-xs tabular-nums text-red-600">− {fmt(filteredSummary.expense)}</span>
                  )}
                  {filteredSummary.income > 0 && filteredSummary.expense > 0 && (
                    <span className={`text-xs tabular-nums font-medium ${filteredSummary.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      = {filteredSummary.net >= 0 ? '+' : '−'} {fmt(Math.abs(filteredSummary.net))}
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* ── Transactions ── */}
            <section id="transactions-section">
              <div className="flex items-center justify-between mb-2 px-4 sm:px-0">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Transactions
                  {totalPages > 1 && <span className="ml-2 normal-case font-normal">· {page}/{totalPages}</span>}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center text-xs bg-white text-stone-600 px-2 py-0.5 rounded border border-stone-400 tracking-tight">account</span>
                  <span className="inline-flex items-center text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full border border-stone-200">budget</span>
                  <span className="inline-flex items-center text-xs bg-white text-stone-500 border border-stone-400 rounded" style={{position:'relative',paddingLeft:12,paddingRight:12,paddingTop:2,paddingBottom:2}}>
                    <span style={{position:'absolute',left:-5,top:'50%',transform:'translateY(-50%)',width:9,height:9,borderRadius:'50%',background:'#fafaf9',border:'1px solid #a8a29e',boxSizing:'border-box'}} />
                    bill
                    <span style={{position:'absolute',right:-5,top:'50%',transform:'translateY(-50%)',width:9,height:9,borderRadius:'50%',background:'#fafaf9',border:'1px solid #a8a29e',boxSizing:'border-box'}} />
                  </span>
                  <span className="inline-flex items-center text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-sm border-l-2 border-blue-300 font-medium">category</span>
                  <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-r-full border-l-2" style={{background:'#faf8f2',color:'#b8a06a',borderColor:'#ddd0a8'}}>
                    <span style={{width:5,height:5,borderRadius:'50%',background:'#b8a06a',display:'inline-block'}} />tag
                  </span>
                </div>
              </div>

              <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                {pageGroups.map(([date, txs]) => (
                  <DateGroup key={date} date={date} transactions={txs} {...handlers} />
                ))}
                {filtered.length === 0 && (
                  <p className="py-12 text-center text-stone-300 text-sm">No transactions found.</p>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-4 sm:px-0">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="text-sm text-stone-500 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed py-2 px-3 -ml-3">
                    ← Zurück
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 h-8 rounded text-xs transition-colors
                          ${p === page ? 'bg-stone-800 text-white' : 'text-stone-400 hover:bg-stone-100'}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="text-sm text-stone-500 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed py-2 px-3 -mr-3">
                    Weiter →
                  </button>
                </div>
              )}
            </section>

            {/* ── Accounts (collapsible) ── */}
            <section>
              <button
                onClick={() => setAccountsOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group"
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">Konten</h2>
                  {loadingAccounts && <SectionSpinner />}
                </div>
                <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                  {accountsOpen ? '▲' : '▼'}
                </span>
              </button>

              {accountsOpen && (
                <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                  {mobile ? (
                    accounts.map(a => (
                      <AccountRow key={a.id} account={a} mobile={true}
                        isActive={filterDestination === a.attributes?.name}
                        onClick={() => applyFilter(setFilterDestination,
                          filterDestination === a.attributes?.name ? null : a.attributes?.name
                        )}
                      />
                    ))
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-stone-200 bg-stone-50">
                          {['Account', 'Type', 'Number', 'Balance'].map(h => (
                            <th key={h} className={`py-2 pr-4 ${h === 'Account' ? 'pl-4' : ''} text-xs font-semibold text-stone-400 uppercase tracking-wide ${h === 'Balance' ? 'text-right' : 'text-left'}`}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map(a => (
                          <AccountRow key={a.id} account={a} mobile={false}
                            isActive={filterDestination === a.attributes?.name}
                            onClick={() => applyFilter(setFilterDestination,
                              filterDestination === a.attributes?.name ? null : a.attributes?.name
                            )}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                  {accounts.length === 0 && (
                    <p className="py-12 text-center text-stone-300 text-sm">No accounts found.</p>
                  )}
                </div>
              )}
            </section>

            {/* ── Categories ── */}
            <section>
              <button onClick={() => setCategoriesOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
                  Categories
                </h2>
                <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                  {categoriesOpen ? '▲' : '▼'}
                </span>
              </button>
              {categoriesOpen && (
                <BudgetCategoryChart
                  transactions={transactions}
                  budgets={budgets}
                  filterBudget={filterBudget}
                  onSelectBudget={v => applyFilter(setFilterBudget, v)}
                  onSelectCategory={cat => applyFilter(setFilterCategory, filterCategory === cat ? null : cat)}
                />
              )}
            </section>

            {/* ── Bills ── */}
            {(bills.length > 0 || loadingBills) && (
              <section>
                <button onClick={() => setBillsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">Bills</h2>
                    {loadingBills && <SectionSpinner />}
                  </div>
                  <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                    {billsOpen ? '▲' : '▼'}
                  </span>
                </button>
                {billsOpen && (
                  <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                    {bills.map(b => (
                      <BillRow key={b.id} bill={b}
                        isActive={filterBill === b.attributes?.name}
                        onClick={() => applyFilter(setFilterBill, filterBill === b.attributes?.name ? null : b.attributes?.name)} />
                    ))}
                    {bills.length === 0 && <p className="py-8 text-center text-stone-300 text-sm">No bills found.</p>}
                  </div>
                )}
              </section>
            )}

            {/* ── Tags ── */}
            {tagSummary.length > 0 && (
              <section>
                <button onClick={() => setTagsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
                    Tags
                  </h2>
                  <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                    {tagsOpen ? '▲' : '▼'}
                  </span>
                </button>
                {tagsOpen && (
                  <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                    <div className="flex flex-wrap gap-2 px-4 py-3">
                      {tagSummary.map(([tag, spent]) => (
                        <button key={tag} onClick={() => applyFilter(setFilterTag, filterTag === tag ? null : tag)}
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors
                            ${filterTag === tag ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
                          <span>{tag}</span>
                          <span className="tabular-nums opacity-70">− {fmt(spent)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Piggy banks ── */}
            <section>
              <button onClick={() => setPiggyBanksOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
                    Piggy banks
                  </h2>
                  {loadingPiggies && <SectionSpinner />}
                </div>
                <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                  {piggyBanksOpen ? '▲' : '▼'}
                </span>
              </button>
              {(() => {
                const hpf = piggyBanks.find(b => b.attributes?.name === HPF_NAME);
                const rest = piggyBanks.filter(b => b.attributes?.name !== HPF_NAME);
                const sorted = hpf ? [hpf, ...rest] : rest;
                if (piggyBanksOpen) {
                  return (
                    <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                      {sorted.map(b => <PiggyBankRow key={b.id} bank={b} />)}
                      {piggyBanks.length === 0 && !loadingPiggies && (
                        <p className="py-8 text-center text-stone-300 text-sm">No piggy banks found.</p>
                      )}
                    </div>
                  );
                }
                if (hpf) {
                  return (
                    <div className="rounded-none sm:rounded-lg border-y sm:border overflow-hidden" style={{ borderColor: HPF_COLOR_MID }}>
                      <PiggyBankRow bank={hpf} />
                    </div>
                  );
                }
                return null;
              })()}
            </section>

            {/* ── Future Vision footer ── */}
            <section className="px-4 sm:px-0">
              {visionOpen ? (
                <div className="rounded-lg overflow-hidden" style={{ border: '0.5px solid #9FE1CB' }}>
                  <div className="flex items-center justify-between px-4 py-2.5" style={{ background: '#E1F5EE', borderBottom: '0.5px solid #9FE1CB' }}>
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M0 9 Q2 6 4 7.5 Q6 9 7 6.5 Q9 4 11 6 Q12.5 7.5 14 6 L14 14 L0 14Z" fill="#5DCAA5" opacity="0.55"/>
                        <path d="M0 11.5 Q3 9.5 5.5 10.5 Q8 11.5 10.5 10 Q12 9 14 10 L14 14 L0 14Z" fill="#1D9E75" opacity="0.65"/>
                        <circle cx="10" cy="3.5" r="2" fill="#9FE1CB" opacity="0.6"/>
                      </svg>
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#085041' }}>Future Vision</span>
                    </div>
                    <button
                      onClick={() => setVisionOpen(false)}
                      className="text-xs hover:text-stone-600 transition-colors"
                      style={{ color: '#0F6E56', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#9FE1CB', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                    >×</button>
                  </div>
                  <div className="bg-white px-4 py-3 flex flex-col gap-3">
                    <textarea
                      value={visionText}
                      onChange={e => setVisionText(e.target.value)}
                      placeholder="In five years I want to…"
                      className="w-full text-sm text-stone-700 border border-stone-200 rounded-md px-3 py-2.5 resize-none outline-none transition-colors"
                      style={{ minHeight: 100, lineHeight: 1.6, fontFamily: 'inherit' }}
                      onFocus={e => e.target.style.borderColor = '#5DCAA5'}
                      onBlur={e => e.target.style.borderColor = ''}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-300">saved locally</span>
                      <button
                        onClick={() => { try { localStorage.setItem('moverview_vision', visionText); } catch {} }}
                        className="text-xs text-white px-4 py-1.5 rounded transition-colors"
                        style={{ background: '#1D9E75', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      >Save</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setVisionOpen(true)}
                  className="w-full overflow-hidden rounded-lg transition-opacity hover:opacity-90"
                  style={{ border: '0.5px solid #9FE1CB', padding: 0, background: 'none', cursor: 'pointer', display: 'block' }}
                >
                  <svg viewBox="0 0 600 80" style={{ width: '100%', height: 'auto', display: 'block' }} fill="none">
                    <rect width="600" height="80" fill="#E1F5EE"/>
                    <rect width="600" height="80" fill="#CCFBF1" opacity="0.35"/>
                    <path d="M0 44 Q30 36 60 40 Q90 44 120 37 Q150 30 180 36 Q210 42 240 35 Q270 28 300 34 Q330 40 360 33 Q390 26 420 32 Q450 38 480 31 Q520 23 560 30 Q580 33 600 28 L600 80 L0 80Z" fill="#9FE1CB" opacity="0.45"/>
                    <path d="M0 54 Q40 46 80 50 Q120 54 160 47 Q200 40 240 46 Q280 52 320 45 Q360 38 400 44 Q440 50 480 43 Q530 35 600 40 L600 80 L0 80Z" fill="#5DCAA5" opacity="0.5"/>
                    <path d="M0 64 Q50 57 100 61 Q150 65 200 58 Q250 51 300 56 Q350 61 400 55 Q450 49 500 54 Q550 59 600 54 L600 80 L0 80Z" fill="#1D9E75" opacity="0.55"/>
                    <path d="M0 72 Q60 67 120 70 Q180 73 240 68 Q300 63 360 67 Q420 71 480 66 Q540 61 600 65 L600 80 L0 80Z" fill="#0F6E56" opacity="0.4"/>
                    <path d="M240 44 Q252 24 264 22 Q276 20 282 34 Q288 22 298 24 Q306 26 308 40" fill="#E1F5EE" opacity="0.6"/>
                    <path d="M60 38 Q70 22 78 20 Q86 18 90 30 Q94 20 102 22 Q108 24 110 36" fill="#E1F5EE" opacity="0.45"/>
                    <path d="M460 36 Q468 22 474 20 Q482 18 486 30 Q490 20 498 22 Q504 24 506 34" fill="#E1F5EE" opacity="0.4"/>
                    <rect x="340" y="32" width="22" height="14" rx="1.5" fill="#085041" opacity="0.12"/>
                    <rect x="345" y="36" width="4" height="3.5" rx="0.5" fill="#085041" opacity="0.18"/>
                    <rect x="352" y="36" width="4" height="3.5" rx="0.5" fill="#085041" opacity="0.18"/>
                    <rect x="347" y="39.5" width="7" height="7" rx="0.5" fill="#085041" opacity="0.15"/>
                    <path d="M336 33 L351 22 L366 33" fill="#0F6E56" opacity="0.2"/>
                    <text x="300" y="70" textAnchor="middle" fontSize="11" fill="#085041" fontFamily="sans-serif" opacity="0.8">Future Vision</text>
                  </svg>
                </button>
              )}
            </section>

            {/* bottom anchor */}
            <div ref={bottomRef} />
          </>
        )}
      </main>

      {/* ── Scroll-to-bottom button ── */}
      {showScrollBtn && !loading && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          aria-label="Scroll to bottom"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 20,
            zIndex: 50,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: '#292524',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            opacity: 0.85,
            fontSize: 22,
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.85'}
        >
          ↓
        </button>
      )}
    </div>
  );
}
