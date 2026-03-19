/**
 * api.js — all network calls go through here.
 *
 * Auth endpoints hit /api/auth/*.
 * Firefly data hits /api/firefly/* which the backend proxies to Firefly-III.
 *
 * On 401 the caller should redirect to /login (handled in App.jsx).
 */

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include', // send session cookie
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || res.statusText);
    e.status = res.status;
    throw e;
  }

  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  me: () => request('/api/auth/me'),
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
};

// ── Firefly-III ───────────────────────────────────────────────────────────────

export const firefly = {
  /** Returns the accounts list. type can be 'asset', 'expense', 'revenue', etc. */
  accounts: (type = 'asset', page = 1) =>
    request(`/api/firefly/accounts?type=${type}&page=${page}`),

  /** Returns paginated transactions */
  transactions: (page = 1, type = 'default') =>
    request(`/api/firefly/transactions?page=${page}&type=${type}`),

  /** Returns basic user info from Firefly */
  about: () => request('/api/firefly/about/user'),

  /** Returns account with its current balance */
  account: (id) => request(`/api/firefly/accounts/${id}`),
};
