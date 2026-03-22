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

  transactions: async (startStr, endStr) => {
    const res = await request(`/api/firefly/transactions?page=1&limit=500&type=default&start=${startStr}&end=${endStr}`);
    return res.data || [];
  },

  // Fetch all bills
  bills: async () => {
    const res = await request('/api/firefly/bills?limit=50');
    return res.data || [];
  },

  budgets: async (startStr, endStr) => {
    const res = await request(`/api/firefly/budgets?limit=50`);
    const budgets = res.data || [];

    const withSpent = await Promise.all(budgets.map(async (b) => {
      try {
        const limRes = await request(`/api/firefly/budgets/${b.id}/limits?limit=10&start=${startStr}&end=${endStr}`);
        const limits = limRes.data || [];
        const spent = limits.reduce((sum, l) => {
          const spentArr = l.attributes?.spent;
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

  // Fetch all budget limit periods in one call using the dedicated endpoint
  budgetPeriods: async () => {
    const now   = new Date();
    const start = new Date(now.getFullYear() - 2, 0, 1).toISOString().slice(0, 10);
    const end   = new Date(now.getFullYear() + 1, 11, 31).toISOString().slice(0, 10);
    const res = await request(`/api/firefly/budget-limits?limit=200&start=${start}&end=${end}`);
    const limits = res.data || [];

    const periodMap = {};
    limits.forEach(l => {
      const start = (l.attributes?.start || '').slice(0, 10);
      const end   = (l.attributes?.end   || '').slice(0, 10);
      if (start && end) {
        const key = `${start}|${end}`;
        if (!periodMap[key]) periodMap[key] = { start, end };
      }
    });

    return Object.values(periodMap).sort((a, b) => b.start.localeCompare(a.start));
  },
};
