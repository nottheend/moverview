import React, { useEffect, useState, useMemo } from 'react';
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

function txType(split) {
  if (split.type === 'withdrawal') return 'expense';
  if (split.type === 'deposit')    return 'income';
  return 'transfer';
}

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

function TransactionCard({ tx, onFilterCategory, onFilterBudget, onFilterTag, onFilterDestination }) {
  const split      = tx.attributes?.transactions?.[0] || {};
  const type       = txType(split);
  const isExpense  = type === 'expense';
  const isTransfer = type === 'transfer';
  const tags       = split.tags || [];

  const destination = isTransfer
    ? split.destination_name
    : isExpense ? split.destination_name : split.source_name;

  return (
    <div className="border-b border-stone-100 px-4 py-3">
      {/* Row 1: description + amount */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-stone-800 font-medium leading-snug flex-1">{split.description || '—'}</p>
        <span className={`text-sm font-semibold tabular-nums shrink-0
          ${isExpense ? 'text-red-600' : isTransfer ? 'text-blue-600' : 'text-emerald-700'}`}>
          {isExpense ? '−' : isTransfer ? '⇄' : '+'} {fmt(split.amount, split.currency_symbol)}
        </span>
      </div>

      {/* Row 2: meta chips */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {split.category_name && (
          <button onClick={() => onFilterCategory(split.category_name)}
            className="text-xs text-stone-500 hover:text-stone-800 hover:underline">
            {split.category_name}
          </button>
        )}
        {split.budget_name && (
          <button onClick={() => onFilterBudget(split.budget_name)}
            className="text-xs text-stone-400 hover:text-stone-700 hover:underline">
            {split.budget_name}
          </button>
        )}
        {destination && (
          <button onClick={() => onFilterDestination(destination)}
            className="text-xs text-stone-400 hover:text-stone-700 hover:underline">
            → {destination}
          </button>
        )}
        {tags.map(tag => (
          <button key={tag} onClick={() => onFilterTag(tag)}
            className="text-xs bg-stone-100 text-stone-500 rounded px-1.5 py-0.5 hover:bg-stone-800 hover:text-white transition-colors">
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Desktop transaction row ───────────────────────────────────────────────────

function TransactionRow({ tx, onFilterCategory, onFilterBudget, onFilterTag, onFilterDestination }) {
  const split      = tx.attributes?.transactions?.[0] || {};
  const type       = txType(split);
  const isExpense  = type === 'expense';
  const isTransfer = type === 'transfer';
  const tags       = split.tags || [];

  const destination = isTransfer
    ? split.destination_name
    : isExpense ? split.destination_name : null;

  return (
    <tr className="border-b border-stone-100 hover:bg-stone-50 transition-colors">
      {/* Description + tags */}
      <td className="py-2.5 pr-3 pl-4">
        <p className="text-sm text-stone-800">{split.description || '—'}</p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map(tag => (
              <button key={tag} onClick={() => onFilterTag(tag)}
                className="text-xs bg-stone-100 text-stone-500 rounded px-1.5 py-0.5 hover:bg-stone-800 hover:text-white transition-colors">
                {tag}
              </button>
            ))}
          </div>
        )}
      </td>
      {/* Category */}
      <td className="py-2.5 pr-3 text-sm whitespace-nowrap">
        <FilterLink value={split.category_name} onClick={onFilterCategory} className="text-stone-500" />
      </td>
      {/* Budget */}
      <td className="py-2.5 pr-3 text-sm whitespace-nowrap">
        <FilterLink value={split.budget_name} onClick={onFilterBudget} className="text-stone-500" />
      </td>
      {/* Source account */}
      <td className="py-2.5 pr-3 text-sm text-stone-400 whitespace-nowrap">
        {isExpense ? split.source_name : isTransfer ? split.source_name : split.destination_name}
      </td>
      {/* Destination account */}
      <td className="py-2.5 pr-3 text-sm whitespace-nowrap">
        <FilterLink value={destination} onClick={onFilterDestination} className="text-stone-400" />
      </td>
      {/* Amount */}
      <td className={`py-2.5 pr-4 text-sm font-medium text-right whitespace-nowrap tabular-nums
        ${isExpense ? 'text-red-600' : isTransfer ? 'text-blue-600' : 'text-emerald-700'}`}>
        {isExpense ? '−' : isTransfer ? '⇄' : '+'} {fmt(split.amount, split.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Date group ────────────────────────────────────────────────────────────────

function DateGroup({ date, transactions, mobile, onFilterCategory, onFilterBudget, onFilterTag, onFilterDestination }) {
  const net = transactions.reduce((sum, tx) => {
    const split  = tx.attributes?.transactions?.[0] || {};
    const type   = txType(split);
    const amount = parseFloat(split.amount || 0);
    if (type === 'expense') return sum - amount;
    if (type === 'income')  return sum + amount;
    return sum;
  }, 0);

  const dateLabel = mobile ? fmtDateShort(date) : fmtDate(date);

  if (mobile) {
    return (
      <>
        <div className="flex items-center justify-between px-4 py-1.5 bg-stone-50 border-b border-stone-200">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-widest">{dateLabel}</span>
          <span className={`text-xs font-semibold tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {net >= 0 ? '+' : '−'} {fmt(Math.abs(net))}
          </span>
        </div>
        {transactions.map(tx => (
          <TransactionCard key={tx.id} tx={tx}
            onFilterCategory={onFilterCategory} onFilterBudget={onFilterBudget}
            onFilterTag={onFilterTag} onFilterDestination={onFilterDestination} />
        ))}
      </>
    );
  }

  return (
    <>
      <tr className="bg-stone-50 border-b border-stone-200">
        <td colSpan={5} className="py-1.5 pl-4">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-widest">{dateLabel}</span>
        </td>
        <td className={`py-1.5 pr-4 text-xs font-semibold text-right tabular-nums
          ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {net >= 0 ? '+' : '−'} {fmt(Math.abs(net))}
        </td>
      </tr>
      {transactions.map(tx => (
        <TransactionRow key={tx.id} tx={tx}
          onFilterCategory={onFilterCategory} onFilterBudget={onFilterBudget}
          onFilterTag={onFilterTag} onFilterDestination={onFilterDestination} />
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
  const [transactions, setTransactions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(false);
  const [fireflyPage,  setFireflyPage]  = useState(1);
  const [error,        setError]        = useState('');

  const [filterCategory,   setFilterCategory]   = useState(null);
  const [filterBudget,     setFilterBudget]      = useState(null);
  const [filterTag,        setFilterTag]         = useState(null);
  const [filterDestination,setFilterDestination] = useState(null);
  const [page,             setPage]              = useState(1);
  const [accountsOpen,    setAccountsOpen]      = useState(false);

  // Detect mobile (< 768px) — re-checked on resize
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [acctRes, txRes] = await Promise.all([
          firefly.accounts('asset'),
          firefly.transactionPage(1),
        ]);
        setAccounts(acctRes.data || []);
        setTransactions(dedupe(txRes.data));
        setHasMore(txRes.hasMore);
        setFireflyPage(1);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = fireflyPage + 1;
      const txRes = await firefly.transactionPage(nextPage);
      setTransactions(prev => dedupe([...prev, ...txRes.data]));
      setHasMore(txRes.hasMore);
      setFireflyPage(nextPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

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
    setFilterCategory(null); setFilterBudget(null);
    setFilterTag(null); setFilterDestination(null);
    setPage(1);
  }

  const filtered = useMemo(() => transactions.filter(tx => {
    const split = tx.attributes?.transactions?.[0] || {};
    const type  = txType(split);
    const dest  = type === 'transfer' || type === 'expense' ? split.destination_name : split.source_name;
    if (filterCategory    && split.category_name !== filterCategory)       return false;
    if (filterBudget      && split.budget_name   !== filterBudget)         return false;
    if (filterTag         && !(split.tags || []).includes(filterTag))      return false;
    if (filterDestination && dest                !== filterDestination)    return false;
    return true;
  }), [transactions, filterCategory, filterBudget, filterTag, filterDestination]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageStart  = (page - 1) * PAGE_SIZE;
  const pageTxs    = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const pageGroups = groupByDate(pageTxs);

  const hasFilters = filterCategory || filterBudget || filterTag || filterDestination;

  const handlers = {
    onFilterCategory:    v => applyFilter(setFilterCategory, v),
    onFilterBudget:      v => applyFilter(setFilterBudget, v),
    onFilterTag:         v => applyFilter(setFilterTag, v),
    onFilterDestination: v => applyFilter(setFilterDestination, v),
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">

      {/* Nav */}
      <header className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="22" height="22" viewBox="0 0 680 680" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <rect width="680" height="680" rx="120" fill="#1c1c2e"/>
            <circle cx="118" cy="340" r="88" fill="#c9a84c"/>
            <circle cx="118" cy="340" r="68" fill="#1c1c2e"/>
            <circle cx="118" cy="340" r="44" fill="#c9a84c"/>
            <text x="340" y="400" textAnchor="middle" fontFamily="Georgia,serif" fontSize="260" fontWeight="700" fill="#c9a84c">M</text>
            <circle cx="562" cy="340" r="88" fill="#c9a84c"/>
            <circle cx="562" cy="340" r="68" fill="#1c1c2e"/>
            <circle cx="562" cy="340" r="44" fill="#c9a84c"/>
          </svg>
          <span className="text-stone-800 font-semibold tracking-tight shrink-0">MOverview</span>
          <span className="text-stone-300 shrink-0">·</span>
          <span className="text-sm text-stone-400 truncate">
            {loading ? 'Loading…' : loadingMore ? `${transactions.length} tx — loading more…` : `${transactions.length} tx loaded`}
            {!loading && !loadingMore && filtered.length !== transactions.length && ` · ${filtered.length} shown`}
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
            {/* ── Active filters ── */}
            {hasFilters && (
              <div className="flex items-center gap-2 flex-wrap px-4">
                <span className="text-xs text-stone-400 uppercase tracking-wide shrink-0">Filter:</span>
                {filterCategory    && <FilterPill label={filterCategory}    onClear={() => applyFilter(setFilterCategory, null)} />}
                {filterBudget      && <FilterPill label={filterBudget}      onClear={() => applyFilter(setFilterBudget, null)} />}
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
                {!mobile && (
                  <span className="text-xs text-stone-300">Tap category, budget, account or tag to filter</span>
                )}
              </div>

              <div className="rounded-none sm:rounded-lg border-y sm:border border-stone-200 bg-white overflow-hidden">
                {mobile ? (
                  // ── Mobile: card list ──
                  <>
                    {pageGroups.map(([date, txs]) => (
                      <DateGroup key={date} date={date} transactions={txs} mobile={true} {...handlers} />
                    ))}
                    {filtered.length === 0 && (
                      <p className="py-12 text-center text-stone-300 text-sm">No transactions found.</p>
                    )}
                  </>
                ) : (
                  // ── Desktop: table ──
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-stone-200 bg-stone-50">
                        {['Description', 'Category', 'Budget', 'From', 'To', 'Amount'].map(h => (
                          <th key={h} className={`py-2 pr-3 ${h === 'Description' ? 'pl-4' : ''} text-xs font-semibold text-stone-400 uppercase tracking-wide ${h === 'Amount' ? 'text-right pr-4' : 'text-left'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageGroups.map(([date, txs]) => (
                        <DateGroup key={date} date={date} transactions={txs} mobile={false} {...handlers} />
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={6} className="py-12 text-center text-stone-300 text-sm">No transactions found.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
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
          </>
        )}
      </main>
    </div>
  );
}
