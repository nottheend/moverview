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

  // Fetch up to 100 transactions, deduplicated by ID, sorted by date descending.
  // Firefly paginates at 50/page so we fetch pages 1+2 and merge.
  // Transfers are returned once by Firefly's /transactions endpoint — no duplication risk.
  // We deduplicate by tx.id anyway as a safety net.
  transactions: async () => {
    const [p1, p2] = await Promise.all([
      request('/api/firefly/transactions?page=1&limit=50&type=default'),
      request('/api/firefly/transactions?page=2&limit=50&type=default'),
    ]);
    const all = [...(p1.data || []), ...(p2.data || [])];

    // Deduplicate by transaction ID
    const seen = new Set();
    const unique = all.filter(tx => {
      if (seen.has(tx.id)) return false;
      seen.add(tx.id);
      return true;
    });

    // Sort by date descending
    return unique.sort((a, b) => {
      const da = new Date(a.attributes?.transactions?.[0]?.date || 0);
      const db = new Date(b.attributes?.transactions?.[0]?.date || 0);
      return db - da;
    });
  },
};
