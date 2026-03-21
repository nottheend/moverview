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

    // Firefly returns pagination in res.meta.pagination
    // Fall back to "got a full page = probably more" if meta is missing
    const pagination = res.meta?.pagination;
    const hasMore = pagination
      ? page < pagination.total_pages
      : data.length === 50;

    return { data, hasMore };
  },
};
