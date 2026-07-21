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

// Flatten split transactions: each split becomes its own row with a stable
// synthetic id so deduplication and React keys work correctly.
function flattenSplits(raw) {
  const flat = [];
  for (const tx of raw) {
    const splits = tx.attributes?.transactions || [];
    if (splits.length <= 1) {
      flat.push(tx);
    } else {
      const groupTitle = tx.attributes?.group_title || splits[0]?.description || '';
      for (let i = 0; i < splits.length; i++) {
        flat.push({
          ...tx,
          id: `${tx.id}-s${i}`,
          _splitIndex: i,
          _groupTitle: groupTitle,
          _isSplit: true,
          attributes: {
            ...tx.attributes,
            transactions: [splits[i]],
          },
        });
      }
    }
  }
  return flat;
}

// Walk Firefly's pagination until every page is in.
//
// Do NOT trust meta.pagination.total_pages: on /tags/{tag}/transactions Firefly
// reports the *unfiltered* transaction count (4787 → "24 pages") while actually
// returning every match on page one. Following that number means two dozen empty
// round trips at ~1.2s each.
//
// The page contents are the only honest signal — a short or empty page is the end.
async function fetchAllPages(path, { limit = 200, maxPages = 25 } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await request(`${path}${sep}page=${page}&limit=${limit}`);
    const batch = res.data || [];
    out.push(...batch);
    if (batch.length < limit) break;
  }
  return out;
}

// Tags are user-typed — never trust the casing.
function splitHasTag(split, tag) {
  const needle = tag.trim().toLowerCase();
  return (split?.tags || []).some(t => String(t).trim().toLowerCase() === needle);
}

export const firefly = {
  accounts: (type = 'asset', page = 1) =>
    request(`/api/firefly/accounts?type=${type}&page=${page}`),

  transactions: async (startStr, endStr) => {
    const res = await request(`/api/firefly/transactions?page=1&limit=500&type=all&start=${startStr}&end=${endStr}`);
    return flattenSplits(res.data || []);
  },

  // All transactions carrying `tag`, flattened to one row per split.
  //
  // Firefly's tag endpoint returns whole groups when *any* split is tagged, so we
  // still filter split-by-split afterwards — a €90 group where only the €30
  // insurance split is tagged must contribute €30, not €90.
  //
  // If the tag endpoint is unavailable (older Firefly, proxy quirk) we fall back to
  // the plain transaction list and filter client-side. Same result, more bytes.
  taggedTransactions: async (tag, startStr, endStr) => {
    const window = `start=${startStr}&end=${endStr}`;
    let raw;
    try {
      raw = await fetchAllPages(`/api/firefly/tags/${encodeURIComponent(tag)}/transactions?${window}`);
    } catch (err) {
      if (err.status === 503) throw err;   // Firefly not configured — no point retrying
      console.warn(`[api] tag endpoint failed (${err.message}) — falling back to full transaction scan`);
      raw = await fetchAllPages(`/api/firefly/transactions?type=all&${window}`);
    }
    return flattenSplits(raw).filter(tx => splitHasTag(tx.attributes?.transactions?.[0], tag));
  },

  // Fetch all bills
  bills: async () => {
    const res = await request('/api/firefly/bills?limit=50');
    return res.data || [];
  },

  // Fetch all piggy banks
  piggyBanks: async () => {
    const res = await request('/api/firefly/piggy-banks?limit=50');
    return res.data || [];
  },

  // Fetch budgets list + per-budget limits once with a wide window.
  // Returns { budgets, periods } so callers can share the single pass.
  // budgets : array enriched with .spent for the given [startStr, endStr]
  // periods : sorted array of { start, end } for the date picker
  // Fetch budget list immediately (fast), then fire per-budget limits calls.
  // onBudgetsReady(budgets)  — called once with name-only list (~150ms)
  // onBudgetResolved(budget) — called per-budget as each limits call finishes
  // Returns a promise that resolves with { periods } when all limits are done.
  budgetsAndPeriods: async (startStr, endStr, { onBudgetsReady, onBudgetResolved } = {}) => {
    const now      = new Date();
    const thisYear = now.getFullYear();
    const wideStart = `${thisYear - 1}-01-01`;
    const wideEnd   = `${thisYear + 1}-12-31`;

    const budgetRes = await request(`/api/firefly/budgets?limit=50`);
    const budgets   = budgetRes.data || [];

    // Notify caller with name-only list right away so pills render immediately
    if (onBudgetsReady) onBudgetsReady(budgets);

    const periodMap = {};

    await Promise.all(budgets.map(async (b) => {
      try {
        const limRes = await request(
          `/api/firefly/budgets/${b.id}/limits?limit=50&start=${wideStart}&end=${wideEnd}`
        );
        const limits = limRes.data || [];

        limits.forEach(l => {
          const s = (l.attributes?.start || '').slice(0, 10);
          const e = (l.attributes?.end   || '').slice(0, 10);
          if (s && e && s >= '2024-11-01') {
            const key = `${s}|${e}`;
            if (!periodMap[key]) periodMap[key] = { start: s, end: e };
          }
        });

        const spent = limits
          .filter(l => {
            const s = (l.attributes?.start || '').slice(0, 10);
            const e = (l.attributes?.end   || '').slice(0, 10);
            return s <= endStr && e >= startStr;
          })
          .reduce((sum, l) => {
            const spentArr = l.attributes?.spent;
            const spentSum = Array.isArray(spentArr)
              ? spentArr.reduce((s, entry) => s + parseFloat(entry.sum || 0), 0)
              : parseFloat(spentArr || 0);
            return sum + spentSum;
          }, 0);

        // Notify caller as each budget resolves individually
        if (onBudgetResolved) onBudgetResolved({ ...b, spent: Math.abs(spent) });
      } catch {
        if (onBudgetResolved) onBudgetResolved({ ...b, spent: 0 });
      }
    }));

    const periods = Object.values(periodMap).sort((a, b) => b.start.localeCompare(a.start));
    return { periods };
  },
};
