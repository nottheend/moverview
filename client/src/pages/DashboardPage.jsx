import React, { useEffect, useState } from 'react';
import { firefly } from '../api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount, symbol = '€') {
  const n = parseFloat(amount);
  return `${symbol}${Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function groupByDate(transactions) {
  const groups = {};
  for (const tx of transactions) {
    const split = tx.attributes?.transactions?.[0] || {};
    const date = split.date?.slice(0, 10) || 'unknown';
    if (!groups[date]) groups[date] = [];
    groups[date].push(tx);
  }
  // Return sorted date keys descending
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

function txType(split) {
  if (split.type === 'withdrawal') return 'expense';
  if (split.type === 'deposit')    return 'income';
  return 'transfer';
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TransactionRow({ tx }) {
  const split = tx.attributes?.transactions?.[0] || {};
  const type = txType(split);
  const isExpense  = type === 'expense';
  const isTransfer = type === 'transfer';

  const amountColor = isExpense ? 'text-red-400' : isTransfer ? 'text-blue-400' : 'text-emerald-400';
  const sign        = isExpense ? '−' : isTransfer ? '⇄' : '+';

  const tags = split.tags || [];

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-900/60 transition-colors">
      {/* Description + tags */}
      <td className="py-3 pr-4">
        <p className="text-sm text-white">{split.description || '—'}</p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map(tag => (
              <span key={tag} className="text-xs bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        )}
      </td>

      {/* Category */}
      <td className="py-3 pr-4 text-sm text-gray-400 whitespace-nowrap">
        {split.category_name || <span className="text-gray-600 italic">uncategorized</span>}
      </td>

      {/* Budget */}
      <td className="py-3 pr-4 text-sm text-gray-400 whitespace-nowrap">
        {split.budget_name || <span className="text-gray-600">—</span>}
      </td>

      {/* Account */}
      <td className="py-3 pr-4 text-sm text-gray-500 whitespace-nowrap">
        {isTransfer
          ? <span>{split.source_name} → {split.destination_name}</span>
          : <span>{isExpense ? split.source_name : split.destination_name}</span>
        }
      </td>

      {/* Amount */}
      <td className={`py-3 text-sm font-semibold text-right whitespace-nowrap ${amountColor}`}>
        {sign} {fmt(split.amount, split.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Date group header ─────────────────────────────────────────────────────────

function DateGroupHeader({ date, transactions }) {
  const total = transactions.reduce((sum, tx) => {
    const split = tx.attributes?.transactions?.[0] || {};
    const type = txType(split);
    const amount = parseFloat(split.amount || 0);
    if (type === 'expense')  return sum - amount;
    if (type === 'income')   return sum + amount;
    return sum;
  }, 0);

  const totalColor = total >= 0 ? 'text-emerald-500' : 'text-red-500';

  return (
    <tr className="bg-gray-900/40">
      <td colSpan={4} className="py-2 px-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          {fmtDate(date)}
        </span>
      </td>
      <td className={`py-2 text-xs font-semibold text-right ${totalColor}`}>
        {total >= 0 ? '+' : '−'} {fmt(Math.abs(total))}
      </td>
    </tr>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({ account }) {
  const attr = account.attributes;
  const balance = parseFloat(attr.current_balance);
  const positive = balance >= 0;
  return (
    <tr className="border-b border-gray-800">
      <td className="py-3 pr-4 text-sm text-white">{attr.name}</td>
      <td className="py-3 pr-4 text-xs text-gray-500 uppercase">{attr.type}</td>
      <td className="py-3 pr-4 text-xs text-gray-500">{attr.account_number || '—'}</td>
      <td className={`py-3 text-sm font-semibold text-right ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmt(attr.current_balance, attr.currency_symbol)}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage({ user, onLogout }) {
  const [accounts, setAccounts]         = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

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

  const groups = groupByDate(transactions);

  // Net totals for header summary
  const totalExpenses = transactions.reduce((sum, tx) => {
    const split = tx.attributes?.transactions?.[0] || {};
    return split.type === 'withdrawal' ? sum + parseFloat(split.amount || 0) : sum;
  }, 0);
  const totalIncome = transactions.reduce((sum, tx) => {
    const split = tx.attributes?.transactions?.[0] || {};
    return split.type === 'deposit' ? sum + parseFloat(split.amount || 0) : sum;
  }, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 bg-gray-950 z-10">
        <h1 className="text-base font-semibold text-white tracking-tight">Firefly Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.username}</span>
          <button onClick={onLogout} className="text-sm text-gray-500 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-12">

        {error && (
          <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <>
            {/* ── Summary bar ── */}
            <section className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-gray-900 border border-gray-800 px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Income</p>
                <p className="text-xl font-semibold text-emerald-400">+ {fmt(totalIncome)}</p>
                <p className="text-xs text-gray-600 mt-1">last {transactions.length} transactions</p>
              </div>
              <div className="rounded-lg bg-gray-900 border border-gray-800 px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Expenses</p>
                <p className="text-xl font-semibold text-red-400">− {fmt(totalExpenses)}</p>
                <p className="text-xs text-gray-600 mt-1">last {transactions.length} transactions</p>
              </div>
              <div className="rounded-lg bg-gray-900 border border-gray-800 px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net</p>
                <p className={`text-xl font-semibold ${totalIncome - totalExpenses >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalIncome - totalExpenses >= 0 ? '+' : '−'} {fmt(Math.abs(totalIncome - totalExpenses))}
                </p>
                <p className="text-xs text-gray-600 mt-1">income − expenses</p>
              </div>
            </section>

            {/* ── Transactions ── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                Transactions · {transactions.length} entries
              </h2>
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Description</th>
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Budget</th>
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Account</th>
                      <th className="py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([date, txs]) => (
                      <React.Fragment key={date}>
                        <DateGroupHeader date={date} transactions={txs} />
                        {txs.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
                      </React.Fragment>
                    ))}
                    {transactions.length === 0 && (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-600 text-sm">No transactions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Accounts (bottom) ── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                Asset Accounts
              </h2>
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Account</th>
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                      <th className="py-2 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Number</th>
                      <th className="py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(a => <AccountRow key={a.id} account={a} />)}
                    {accounts.length === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-600 text-sm">No accounts found.</td></tr>
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
