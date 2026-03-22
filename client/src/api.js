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

  // Fetch budget periods using per-budget limits endpoint (more reliable than /budget-limits)
  budgetPeriods: async () => {
    const now      = new Date();
    const thisYear = now.getFullYear();
    const start    = `${thisYear - 1}-01-01`;
    const end      = `${thisYear + 1}-12-31`;

    const budgetRes = await request(`/api/firefly/budgets?limit=50`);
    const budgets   = budgetRes.data || [];

    const periodMap = {};
    await Promise.all(budgets.map(async b => {
      try {
        const limRes = await request(`/api/firefly/budgets/${b.id}/limits?limit=50&start=${start}&end=${end}`);
        (limRes.data || []).forEach(l => {
          const s = (l.attributes?.start || '').slice(0, 10);
          const e = (l.attributes?.end   || '').slice(0, 10);
          if (s && e && s >= '2024-11-01') {
            const key = `${s}|${e}`;
            if (!periodMap[key]) periodMap[key] = { start: s, end: e };
          }
        });
      } catch { /* skip budget on error */ }
    }));

    return Object.values(periodMap).sort((a, b) => b.start.localeCompare(a.start));
  },
};
