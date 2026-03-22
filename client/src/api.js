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
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const startStr = start.toISOString().slice(0, 10);
    const endStr   = end.toISOString().slice(0, 10);
    const res = await request(`/api/firefly/transactions?page=${page}&limit=50&type=default&start=${startStr}&end=${endStr}`);
    const data = res.data || [];
    const pagination = res.meta?.pagination;
    const hasMore = pagination ? page < pagination.total_pages : data.length === 50;
    return { data, hasMore };
  },

  // Fetch all bills
  bills: async () => {
    const res = await request('/api/firefly/bills?limit=50');
    return res.data || [];
  },

  budgets: async () => {
    const res = await request('/api/firefly/budgets?limit=50');
    const budgets = res.data || [];

    // For each budget fetch the spent amount from budget limits
    const withSpent = await Promise.all(budgets.map(async (b) => {
      try {
        const limRes = await request(`/api/firefly/budgets/${b.id}/limits?limit=10`);
        const limits = limRes.data || [];
        const spent = limits.reduce((sum, l) => {
          const spentArr = l.attributes?.spent;
          // Firefly III returns spent as an array of { sum: "-123.45", currency_id: ... }
          const spentSum = Array.isArray(spentArr)
            ? spentArr.reduce((s, entry) => s + parseFloat(entry.sum || 0), 0)
            : parseFloat(spentArr || 0);
          return sum + spentSum;
        }, 0);
        return { ...b, spent: Math.abs(spent) };
      } catch {
        return { ...b, spent: 0 };
      }
    }));

    return withSpent;
  },
};
