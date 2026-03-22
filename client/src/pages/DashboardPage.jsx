import React, { useEffect, useState, useMemo, useRef } from 'react';
import { firefly } from '../api.js';

// ── Date range helpers ────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }

function getPreset(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'last30': {
      const s = new Date(); s.setDate(s.getDate() - 30);
      return { start: toISO(s), end: toISO(now), label: 'Last 30 days' };
    }
    case 'thisMonth':
      return { start: toISO(new Date(y, m, 1)), end: toISO(now), label: 'This month' };
    case 'lastMonth': {
      const s = new Date(y, m - 1, 1);
      const e = new Date(y, m, 0);
      return { start: toISO(s), end: toISO(e), label: 'Last month' };
    }
    case 'thisYear':
      return { start: toISO(new Date(y, 0, 1)), end: toISO(now), label: 'This year' };
    default:
      return getPreset('last30');
  }
}

const PRESETS = [
  { key: 'last30',    label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear',  label: 'This year' },
];

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

  const source      = split.source_name;
  const destination = split.destination_name;
  const flowArrow   = isTransfer ? '⇄' : '→';

  const amountColor = isExpense ? 'text-red-600' : isTransfer ? 'text-indigo-600' : 'text-emerald-700';
  const typeLabel   = isExpense ? 'Expense' : isTransfer ? 'Transfer' : 'Income';
  const dateLabel   = split.date ? fmtDateShort(split.date) : null;

  return (
    <div className="border-b border-stone-100 px-4 py-3 hover:bg-stone-50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-1 min-w-0 pt-0.5">
          <p className="text-sm text-stone-800 font-medium leading-snug">{split.description || '—'}</p>
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

function AccountRow({ account, mobile }) {
  const attr    = account.attributes;
  const balance = parseFloat(attr.current_balance);

  if (mobile) {
    return (
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
        <div>
          <p className="text-sm text-stone-800 font-medium">{attr.name}</p>
          <p className="text-xs text-stone-400 mt-0.5">{attr.account_number || attr.type}</p>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          {fmt(attr.current_balance, attr.currency_symbol)}
        </span>
      </div>
    );
  }

  return (
    <tr className="border-b border-stone-100 hover:bg-stone-50">
      <td className="py-2.5 pl-4 pr-4 text-sm text-stone-800 font-medium">{attr.name}</td>
      <td className="py-2.5 pr-4 text-xs text-stone-400 uppercase tracking-wide">{attr.type}</td>
      <td className="py-2.5 pr-4 text-sm text-stone-400 font-mono">{attr.account_number || '—'}</td>
      <td className={`py-2.5 pr-4 text-sm font-semibold text-right tabular-nums
        ${balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
        {fmt(attr.current_balance, attr.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DashboardPage({ user, onLogout }) {
  const [accounts,     setAccounts]     = useState([]);
  const [budgets,      setBudgets]      = useState([]);
  const [bills,        setBills]        = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgetPeriods,setBudgetPeriods]= useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const [datePreset,   setDatePreset]   = useState('last30');
  const [customStart,  setCustomStart]  = useState('');
  const [customEnd,    setCustomEnd]    = useState('');
  const [pickerOpen,   setPickerOpen]   = useState(false);
  const pickerRef = useRef(null);

  const activeDateRange = useMemo(() => {
    if (datePreset === 'custom' && customStart && customEnd)
      return { start: customStart, end: customEnd, label: `${fmtDateShort(customStart)} – ${fmtDateShort(customEnd)}` };
    return getPreset(datePreset);
  }, [datePreset, customStart, customEnd]);

  const [filterCategory,   setFilterCategory]   = useState(null);
  const [filterBudget,     setFilterBudget]      = useState(null);
  const [filterBill,       setFilterBill]        = useState(null);
  const [filterTag,        setFilterTag]         = useState(null);
  const [filterDestination,setFilterDestination] = useState(null);
  const [page,             setPage]              = useState(1);
  const [accountsOpen,    setAccountsOpen]      = useState(false);
  const [categoriesOpen,   setCategoriesOpen]   = useState(false);
  const [billsOpen,        setBillsOpen]        = useState(false);
  const [tagsOpen,         setTagsOpen]         = useState(false);

  // Detect mobile (< 768px) — re-checked on resize
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Fetch budget periods once on mount
  useEffect(() => {
    firefly.budgetPeriods().then(setBudgetPeriods).catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setTransactions([]);
      setPage(1);
      try {
        const { start, end } = activeDateRange;
        const [acctRes, txData, budgetList, billList] = await Promise.all([
          firefly.accounts('asset'),
          firefly.transactions(start, end),
          firefly.budgets(start, end),
          firefly.bills(),
        ]);
        setAccounts(acctRes.data || []);
        setTransactions(dedupe(txData));
        setBudgets(budgetList);
        setBills(billList);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
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
    setFilterTag(null); setFilterDestination(null);
    setPage(1);
  }

  const filtered = useMemo(() => transactions.filter(tx => {
    const split = tx.attributes?.transactions?.[0] || {};
    const type  = txType(split);
    const dest  = type === 'transfer' || type === 'expense' ? split.destination_name : split.source_name;
    if (filterCategory    && split.category_name !== filterCategory)       return false;
    if (filterBudget      && split.budget_name   !== filterBudget)         return false;
    if (filterBill        && split.bill_name     !== filterBill)           return false;
    if (filterTag         && !(split.tags || []).includes(filterTag))      return false;
    if (filterDestination && dest                !== filterDestination)    return false;
    return true;
  }), [transactions, filterCategory, filterBudget, filterBill, filterTag, filterDestination]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageStart  = (page - 1) * PAGE_SIZE;
  const pageTxs    = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const pageGroups = groupByDate(pageTxs);

  const hasFilters = filterCategory || filterBudget || filterBill || filterTag || filterDestination;

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
      <header className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/icon.svg" alt="MOverview" className="w-7 h-7 shrink-0" /><span className="text-stone-800 font-semibold tracking-tight shrink-0">MOverview</span>
          <span className="text-stone-300 shrink-0">·</span>
          <span className="text-sm text-stone-400 truncate">
            {loading ? 'Loading…' : `${transactions.length} transactions`}
            {!loading && filtered.length !== transactions.length && ` · ${filtered.length} shown`}
          </span>
        </div>
        <span className="text-xs text-stone-300 shrink-0 hidden sm:inline">{__APP_VERSION__}</span>
        <button onClick={onLogout} className="text-sm text-stone-400 hover:text-stone-700 transition-colors shrink-0 ml-2">
          Sign out
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-0 sm:px-4 py-6 space-y-6">

        {error && (
          <div className="mx-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-stone-400 text-sm py-12 text-center">Loading…</p>
        ) : (
          <>
            {/* ── Budget strip ── */}
            {budgets.length > 0 && (
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
                      {activeDateRange.label}
                      <span className="text-stone-400 text-xs">{pickerOpen ? '▲' : '▼'}</span>
                    </button>
                    {pickerOpen && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-stone-200 rounded-lg shadow-lg z-50 min-w-[240px] overflow-hidden">
                        {PRESETS.map(p => (
                          <button key={p.key}
                            onClick={() => { setDatePreset(p.key); setPickerOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors
                              ${datePreset === p.key ? 'font-semibold text-stone-800 bg-stone-50' : 'text-stone-600'}`}>
                            {p.label}
                          </button>
                        ))}
                        {budgetPeriods.length > 0 && (
                          <>
                            <div className="px-4 py-2 border-t border-stone-100 bg-stone-50">
                              <p className="text-xs text-stone-400 uppercase tracking-wide">Budget periods</p>
                            </div>
                            {budgetPeriods.map(p => {
                              const label = `${fmtDateShort(p.start)} – ${fmtDateShort(p.end)}`;
                              const key = `${p.start}|${p.end}`;
                              const isActive = datePreset === 'custom' && customStart === p.start && customEnd === p.end;
                              return (
                                <button key={key}
                                  onClick={() => { setDatePreset('custom'); setCustomStart(p.start); setCustomEnd(p.end); setPickerOpen(false); }}
                                  className={`w-full text-left px-4 py-2 text-sm border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors
                                    ${isActive ? 'font-semibold text-stone-800 bg-stone-50' : 'text-stone-600'}`}>
                                  {label}
                                </button>
                              );
                            })}
                          </>
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
                              onClick={() => { setDatePreset('custom'); setPickerOpen(false); }}
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
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Budgets</h2>
                <div className="flex flex-wrap gap-2">
                  {budgets.map(b => {
                    const name = b.attributes?.name || '—';
                    const spent = b.spent || 0;
                    const isActive = filterBudget === name;
                    return (
                      <button key={b.id} onClick={() => applyFilter(setFilterBudget, isActive ? null : name)}
                        className={`flex items-center gap-2 text-sm px-4 py-1.5 rounded-full border transition-colors
                          ${isActive
                            ? 'bg-stone-800 border-stone-800 text-white'
                            : 'bg-white border-stone-200 text-stone-600 hover:border-stone-400'}`}>
                        <span>{name}</span>
                        {spent > 0 && (
                          <span className={`text-xs tabular-nums ${isActive ? 'text-stone-300' : 'text-stone-400'}`}>
                            {fmt(spent)}
                          </span>
                        )}
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
                {filterTag         && <FilterPill label={filterTag}         onClear={() => applyFilter(setFilterTag, null)} />}
                {filterDestination && <FilterPill label={`→ ${filterDestination}`} onClear={() => applyFilter(setFilterDestination, null)} />}
                <button onClick={clearAll} className="text-xs text-stone-400 hover:text-stone-700 underline">
                  Clear all
                </button>
              </div>
            )}

            {/* ── Transactions ── */}
            <section>
              <div className="flex items-center justify-between mb-2 px-4 sm:px-0">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Transactions
                  {totalPages > 1 && <span className="ml-2 normal-case font-normal">· {page}/{totalPages}</span>}
                </h2>
                <div className="hidden sm:flex items-center gap-2">
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
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
                  Konten
                </h2>
                <span className="text-stone-300 group-hover:text-stone-500 transition-colors text-sm">
                  {accountsOpen ? '▲' : '▼'}
                </span>
              </button>

              {accountsOpen && (
                <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                  {mobile ? (
                    accounts.map(a => <AccountRow key={a.id} account={a} mobile={true} />)
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
                        {accounts.map(a => <AccountRow key={a.id} account={a} mobile={false} />)}
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
                <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                  {categorySummary.map(([cat, spent]) => (
                    <button key={cat} onClick={() => applyFilter(setFilterCategory, filterCategory === cat ? null : cat)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors
                        ${filterCategory === cat ? 'bg-stone-50' : ''}`}>
                      <span className={`text-sm ${filterCategory === cat ? 'font-semibold text-stone-800' : 'text-stone-600'}`}>{cat}</span>
                      <span className="text-sm tabular-nums text-red-600">− {fmt(spent)}</span>
                    </button>
                  ))}
                  {categorySummary.length === 0 && <p className="py-8 text-center text-stone-300 text-sm">No categories found.</p>}
                </div>
              )}
            </section>

            {/* ── Bills ── */}
            {bills.length > 0 && (
              <section>
                <button onClick={() => setBillsOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 sm:px-0 mb-2 group">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-600 transition-colors">
                    Bills
                  </h2>
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
          </>
        )}
      </main>
    </div>
  );
}
