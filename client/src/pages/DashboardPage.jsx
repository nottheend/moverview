import React, { useEffect, useState } from 'react';
import { firefly } from '../api.js';

// ── small helpers ─────────────────────────────────────────────────────────────

function currency(amount, currencySymbol = '€') {
  const n = parseFloat(amount);
  return `${currencySymbol}${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeDate(dateStr) {
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── sub-components ────────────────────────────────────────────────────────────

function AccountCard({ account }) {
  const attr = account.attributes;
  const positive = parseFloat(attr.current_balance) >= 0;
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{attr.type}</span>
      <span className="font-semibold text-white truncate">{attr.name}</span>
      <span className={`text-xl font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {currency(attr.current_balance, attr.currency_symbol)}
      </span>
    </div>
  );
}

function TransactionRow({ tx }) {
  const attr = tx.attributes;
  const split = attr.transactions?.[0] || {};
  const isExpense = split.type === 'withdrawal';
  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-800 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{split.description}</p>
        <p className="text-xs text-gray-500">{split.category_name || 'Uncategorized'} · {relativeDate(split.date)}</p>
      </div>
      <span className={`text-sm font-semibold shrink-0 ${isExpense ? 'text-red-400' : 'text-emerald-400'}`}>
        {isExpense ? '−' : '+'}{currency(split.amount, split.currency_symbol)}
      </span>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage({ user, onLogout }) {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [acctRes, txRes] = await Promise.all([
          firefly.accounts('asset'),
          firefly.transactions(1),
        ]);
        setAccounts(acctRes.data || []);
        setTransactions(txRes.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Nav */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Firefly Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.username}</span>
          <button
            onClick={onLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-10">
        {error && (
          <div className="rounded-xl bg-red-900/30 border border-red-700 px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading data…</p>
        ) : (
          <>
            {/* Accounts */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                Asset Accounts
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map((a) => (
                  <AccountCard key={a.id} account={a} />
                ))}
                {accounts.length === 0 && (
                  <p className="text-gray-500 text-sm">No asset accounts found.</p>
                )}
              </div>
            </section>

            {/* Transactions */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">
                Recent Transactions
              </h2>
              <div className="rounded-xl bg-gray-900 border border-gray-800 px-5 py-2">
                {transactions.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} />
                ))}
                {transactions.length === 0 && (
                  <p className="py-4 text-gray-500 text-sm">No transactions found.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
