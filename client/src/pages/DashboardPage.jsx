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
    <span className="inline-flex items-center gap-1.5 bg-stone-800 text-white text-xs rounded-full px-3 py-1">
      {label}
      <button onClick={onClear} className="hover:text-stone-300 font-bold leading-none">×</button>
    </span>
  );
}

// ── Clickable cell value ──────────────────────────────────────────────────────

function FilterLink({ value, onClick, className = '' }) {
  if (!value) return <span className="text-stone-300">—</span>;
  return (
    <button
      onClick={() => onClick(value)}
      className={`text-left hover:underline hover:text-stone-700 transition-colors ${className}`}
    >
      {value}
    </button>
  );
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TransactionRow({ tx, onFilterCategory, onFilterBudget, onFilterTag }) {
  const split = tx.attributes?.transactions?.[0] || {};
  const type  = txType(split);
  const isExpense  = type === 'expense';
  const isTransfer = type === 'transfer';
  const tags = split.tags || [];

  return (
    <tr className="border-b border-stone-100 hover:bg-stone-50 transition-colors">
      <td className="py-2.5 pr-4 pl-4">
        <p className="text-sm text-stone-800">{split.description || '—'}</p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => onFilterTag(tag)}
                className="text-xs bg-stone-100 text-stone-500 rounded px-1.5 py-0.5 hover:bg-stone-800 hover:text-white transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-4 text-sm text-stone-500 whitespace-nowrap">
        <FilterLink value={split.category_name} onClick={onFilterCategory} className="text-stone-500" />
      </td>
      <td className="py-2.5 pr-4 text-sm text-stone-500 whitespace-nowrap">
        <FilterLink value={split.budget_name} onClick={onFilterBudget} className="text-stone-500" />
      </td>
      <td className="py-2.5 pr-4 text-sm text-stone-400 whitespace-nowrap">
        {isTransfer
          ? `${split.source_name} → ${split.destination_name}`
          : isExpense ? split.source_name : split.destination_name
        }
      </td>
      <td className={`py-2.5 pr-4 text-sm font-medium text-right whitespace-nowrap tabular-nums
        ${isExpense ? 'text-red-600' : isTransfer ? 'text-blue-600' : 'text-emerald-700'}`}>
        {isExpense ? '−' : isTransfer ? '⇄' : '+'} {fmt(split.amount, split.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Date group ────────────────────────────────────────────────────────────────

function DateGroup({ date, transactions, onFilterCategory, onFilterBudget, onFilterTag }) {
  const net = transactions.reduce((sum, tx) => {
    const split  = tx.attributes?.transactions?.[0] || {};
    const type   = txType(split);
    const amount = parseFloat(split.amount || 0);
    if (type === 'expense') return sum - amount;
    if (type === 'income')  return sum + amount;
    return sum;
  }, 0);

  return (
    <>
      <tr className="bg-stone-50 border-b border-stone-200">
        <td colSpan={4} className="py-1.5 pl-4">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-widest">
            {fmtDate(date)}
          </span>
        </td>
        <td className={`py-1.5 pr-4 text-xs font-semibold text-right tabular-nums
          ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {net >= 0 ? '+' : '−'} {fmt(Math.abs(net))}
        </td>
      </tr>
      {transactions.map(tx => (
        <TransactionRow
          key={tx.id} tx={tx}
          onFilterCategory={onFilterCategory}
          onFilterBudget={onFilterBudget}
          onFilterTag={onFilterTag}
        />
      ))}
    </>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({ account }) {
  const attr    = account.attributes;
  const balance = parseFloat(attr.current_balance);
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
  const [error,        setError]        = useState('');

  // Filters
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterBudget,   setFilterBudget]   = useState(null);
  const [filterTag,      setFilterTag]      = useState(null);

  // Pagination
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function load() {
      try {
        const [acctRes, txList] = await Promise.all([
          firefly.accounts('asset'),
          firefly.transactions(),
        ]);
        setAccounts(acctRes.data || []);
        setTransactions(txList);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Reset page when filters change
  function applyFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  // Filtered transactions
  const filtered = useMemo(() => transactions.filter(tx => {
    const split = tx.attributes?.transactions?.[0] || {};
    if (filterCategory && split.category_name !== filterCategory) return false;
    if (filterBudget   && split.budget_name   !== filterBudget)   return false;
    if (filterTag      && !(split.tags || []).includes(filterTag)) return false;
    return true;
  }), [transactions, filterCategory, filterBudget, filterTag]);

  // Paginated slice (applied after grouping by date)
  const allGroups   = groupByDate(filtered);
  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);

  // Get the transactions for the current page by slicing the flat list then re-grouping
  const pageStart   = (page - 1) * PAGE_SIZE;
  const pageTxs     = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const pageGroups  = groupByDate(pageTxs);

  const hasFilters = filterCategory || filterBudget || filterTag;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">

      {/* Nav */}
      <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-stone-800 font-semibold tracking-tight">Moverview</span>
          <span className="text-stone-300">·</span>
          <span className="text-sm text-stone-400">
            {filtered.length}{filtered.length !== transactions.length ? ` of ${transactions.length}` : ''} transactions
          </span>
        </div>
        <button onClick={onLogout} className="text-sm text-stone-400 hover:text-stone-700 transition-colors">
          Sign out
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-stone-400 text-sm py-12 text-center">Loading…</p>
        ) : (
          <>
            {/* ── Active filters ── */}
            {hasFilters && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400 uppercase tracking-wide">Filtered by:</span>
                {filterCategory && <FilterPill label={`Category: ${filterCategory}`} onClear={() => applyFilter(setFilterCategory, null)} />}
                {filterBudget   && <FilterPill label={`Budget: ${filterBudget}`}     onClear={() => applyFilter(setFilterBudget, null)} />}
                {filterTag      && <FilterPill label={`Tag: ${filterTag}`}            onClear={() => applyFilter(setFilterTag, null)} />}
                <button onClick={() => { setFilterCategory(null); setFilterBudget(null); setFilterTag(null); setPage(1); }}
                  className="text-xs text-stone-400 hover:text-stone-700 underline ml-1">
                  Clear all
                </button>
              </div>
            )}

            {/* ── Transactions ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                  Transactions
                  {totalPages > 1 && <span className="ml-2 normal-case font-normal">· page {page} of {totalPages}</span>}
                </h2>
                <span className="text-xs text-stone-400">Click category, budget or tag to filter</span>
              </div>

              <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50">
                      {['Description', 'Category', 'Budget', 'Account', 'Amount'].map(h => (
                        <th key={h} className={`py-2 pr-4 ${h === 'Description' ? 'pl-4' : ''} text-xs font-semibold text-stone-400 uppercase tracking-wide ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageGroups.map(([date, txs]) => (
                      <DateGroup
                        key={date} date={date} transactions={txs}
                        onFilterCategory={v => applyFilter(setFilterCategory, v)}
                        onFilterBudget={v   => applyFilter(setFilterBudget, v)}
                        onFilterTag={v      => applyFilter(setFilterTag, v)}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={5} className="py-12 text-center text-stone-300 text-sm">No transactions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-sm text-stone-500 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Previous
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded text-xs transition-colors
                          ${p === page ? 'bg-stone-800 text-white' : 'text-stone-400 hover:bg-stone-100'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-sm text-stone-500 hover:text-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}
            </section>

            {/* ── Accounts ── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
                Asset Accounts
              </h2>
              <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
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
                    {accounts.map(a => <AccountRow key={a.id} account={a} />)}
                    {accounts.length === 0 && (
                      <tr><td colSpan={4} className="py-12 text-center text-stone-300 text-sm">No accounts found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
