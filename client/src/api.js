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

  transactionPage: async (page = 1) => {
    const res = await request(`/api/firefly/transactions?page=${page}&limit=50&type=default`);
    const data = res.data || [];
    const pagination = res.meta?.pagination;
    const hasMore = pagination ? page < pagination.total_pages : data.length === 50;
    return { data, hasMore };
  },

  // Fetch all budgets with their spent amount for the current period
  budgets: async () => {
    const res = await request('/api/firefly/budgets?limit=50');
    const budgets = res.data || [];

    // For each budget fetch the spent amount from budget limits
    const withSpent = await Promise.all(budgets.map(async (b) => {
      try {
        const limRes = await request(`/api/firefly/budgets/${b.id}/limits?limit=10`);
        const limits = limRes.data || [];
        const spent = limits.reduce((sum, l) => sum + parseFloat(l.attributes?.spent || 0), 0);
        return { ...b, spent: Math.abs(spent) };
      } catch {
        return { ...b, spent: 0 };
      }
    }));

    return withSpent;
  },
};
