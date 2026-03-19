'use strict';

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const FIREFLY_BASE_URL = (process.env.FIREFLY_BASE_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

// In production, Cloudron's proxyAuth blocks all unauthenticated requests
// before they reach us — so if a request arrives, the user is logged in.
// In dev, NODE_ENV is not set, so we skip the auth wall entirely.
const IS_DEV = process.env.NODE_ENV !== 'production';

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Auth: inject a user object for the frontend ───────────────────────────────
//
// proxyAuth does not pass username headers (as of Cloudron 9.x).
// We just confirm the user is "authenticated" (i.e. made it past Cloudron's wall).
// In dev we use 'devuser'.

app.use((req, res, next) => {
  req.cloudronUser = { username: IS_DEV ? 'devuser' : 'cloudron-user' };
  next();
});

// ── Auth routes ───────────────────────────────────────────────────────────────

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.cloudronUser });
});

app.post('/api/auth/logout', (req, res) => {
  // proxyAuth handles logout at /logout (reserved by Cloudron).
  // In dev just return ok.
  res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Firefly-III proxy ─────────────────────────────────────────────────────────

app.get('/api/firefly/*', async (req, res) => {
  if (!FIREFLY_BASE_URL || !FIREFLY_TOKEN) {
    return res.status(503).json({ error: 'Firefly not configured (set FIREFLY_BASE_URL and FIREFLY_TOKEN)' });
  }

  const fireflyPath = req.path.replace(/^\/api\/firefly/, '/api/v1');
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${FIREFLY_BASE_URL}${fireflyPath}${queryString}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${FIREFLY_TOKEN}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[proxy] Firefly request failed:', err.message);
    res.status(502).json({ error: 'Failed to reach Firefly-III', detail: err.message });
  }
});

// ── Serve React frontend ──────────────────────────────────────────────────────

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_DIST));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] Mode: ${IS_DEV ? 'DEV (no auth wall)' : 'PRODUCTION (Cloudron proxyAuth wall active)'}`);
  console.log(`[server] Firefly target: ${FIREFLY_BASE_URL || '(not set)'}`);
});
