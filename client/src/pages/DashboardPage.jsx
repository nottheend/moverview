import React, { useEffect, useState } from 'react';
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

function fmtMonth(dateStr) {
  return new Date(dateStr + '-01').toLocaleDateString('de-DE', {
    month: 'long', year: 'numeric',
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

function groupByMonth(transactions) {
  const months = {};
  for (const tx of transactions) {
    const split = tx.attributes?.transactions?.[0] || {};
    const month = split.date?.slice(0, 7) || 'unknown';
    if (!months[month]) months[month] = { income: 0, expenses: 0 };
    const type = txType(split);
    const amount = parseFloat(split.amount || 0);
    if (type === 'expense') months[month].expenses += amount;
    if (type === 'income')  months[month].income   += amount;
  }
  return Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
}

// ── Timeline bar chart ────────────────────────────────────────────────────────

function Timeline({ transactions }) {
  const months = groupByMonth(transactions);
  if (months.length === 0) return null;

  const maxVal = Math.max(...months.map(([, m]) => Math.max(m.income, m.expenses)), 1);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-6">
        Monthly overview
      </h2>
      <div className="flex items-end gap-3 h-32">
        {months.map(([month, data]) => (
          <div key={month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full flex items-end gap-0.5 h-24 justify-center">
              {/* Income bar */}
              <div
                className="flex-1 bg-emerald-200 rounded-t"
                style={{ height: `${(data.income / maxVal) * 100}%`, minHeight: data.income > 0 ? 2 : 0 }}
                title={`Income: ${fmt(data.income)}`}
              />
              {/* Expense bar */}
              <div
                className="flex-1 bg-red-200 rounded-t"
                style={{ height: `${(data.expenses / maxVal) * 100}%`, minHeight: data.expenses > 0 ? 2 : 0 }}
                title={`Expenses: ${fmt(data.expenses)}`}
              />
            </div>
            <span className="text-xs text-stone-400 truncate w-full text-center">
              {new Date(month + '-01').toLocaleDateString('de-DE', { month: 'short' })}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded-sm bg-emerald-200 inline-block" /> Income
        </span>
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded-sm bg-red-200 inline-block" /> Expenses
        </span>
      </div>
    </div>
  );
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TransactionRow({ tx }) {
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
              <span key={tag} className="text-xs bg-stone-100 text-stone-500 rounded px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-4 text-sm text-stone-500 whitespace-nowrap">
        {split.category_name || <span className="text-stone-300 italic">—</span>}
      </td>
      <td className="py-2.5 pr-4 text-sm text-stone-500 whitespace-nowrap">
        {split.budget_name || <span className="text-stone-300">—</span>}
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

function DateGroup({ date, transactions }) {
  const net = transactions.reduce((sum, tx) => {
    const split = tx.attributes?.transactions?.[0] || {};
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
      {transactions.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
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

  const totalIncome   = transactions.reduce((s, tx) => {
    const sp = tx.attributes?.transactions?.[0] || {};
    return sp.type === 'deposit'    ? s + parseFloat(sp.amount || 0) : s;
  }, 0);
  const totalExpenses = transactions.reduce((s, tx) => {
    const sp = tx.attributes?.transactions?.[0] || {};
    return sp.type === 'withdrawal' ? s + parseFloat(sp.amount || 0) : s;
  }, 0);
  const net = totalIncome - totalExpenses;

  const totalBalance = accounts.reduce((s, a) =>
    s + parseFloat(a.attributes?.current_balance || 0), 0);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">

      {/* Nav */}
      <header className="bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-stone-800 font-semibold tracking-tight">Moverview</span>
          <span className="text-stone-300">·</span>
          <span className="text-sm text-stone-400">{transactions.length} transactions loaded</span>
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
            {/* ── KPI strip ── */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total balance',  value: fmt(totalBalance),   color: totalBalance >= 0 ? 'text-emerald-700' : 'text-red-600', sign: '' },
                { label: 'Income',         value: fmt(totalIncome),    color: 'text-emerald-700', sign: '+' },
                { label: 'Expenses',       value: fmt(totalExpenses),  color: 'text-red-600',     sign: '−' },
                { label: 'Net',            value: fmt(Math.abs(net)),  color: net >= 0 ? 'text-emerald-700' : 'text-red-600', sign: net >= 0 ? '+' : '−' },
              ].map(({ label, value, color, sign }) => (
                <div key={label} className="bg-white rounded-lg border border-stone-200 px-5 py-4">
                  <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">{label}</p>
                  <p className={`text-xl font-semibold tabular-nums ${color}`}>{sign} {value}</p>
                </div>
              ))}
            </div>

            {/* ── Timeline ── */}
            <Timeline transactions={transactions} />

            {/* ── Transactions ── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
                Transactions
              </h2>
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
                    {groups.map(([date, txs]) => (
                      <DateGroup key={date} date={date} transactions={txs} />
                    ))}
                    {transactions.length === 0 && (
                      <tr><td colSpan={5} className="py-12 text-center text-stone-300 text-sm">No transactions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
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
