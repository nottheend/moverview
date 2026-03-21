async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
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

export const auth = {
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
};

export const firefly = {
  accounts: (type = 'asset', page = 1) =>
    request(`/api/firefly/accounts?type=${type}&page=${page}`),

  // Fetch a single page of 50 transactions from Firefly.
  // Returns { data, hasMore } where hasMore = true if there may be more pages.
  transactionPage: async (page = 1) => {
    const res = await request(`/api/firefly/transactions?page=${page}&limit=50&type=default`);
    const data = res.data || [];
    const total = res.meta?.pagination?.total || 0;
    const hasMore = page * 50 < total;
    return { data, hasMore, total };
  },
};
