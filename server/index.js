'use strict';

const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const FIREFLY_BASE_URL = (process.env.FIREFLY_BASE_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

// With proxyAuth addon, Cloudron handles login before requests reach us.
// The logged-in username is injected as the X-Cloudron-Username header.
// In local dev this header won't exist, so we fall back to 'devuser'.
const IS_DEV = process.env.NODE_ENV !== 'production';

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const KnexSessionStore = require('connect-session-knex')(session);
const knex = require('knex')({
  client: 'better-sqlite3',
  connection: { filename: IS_DEV ? '/tmp/sessions.db' : '/app/data/sessions.db' },
  useNullAsDefault: true,
});
const store = new KnexSessionStore({ knex, createtable: true });

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store,
  cookie: {
    httpOnly: true,
    secure: !IS_DEV,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// ── Auth: read user from Cloudron proxyAuth header ───────────────────────────
//
// Cloudron's proxyAuth addon injects X-Cloudron-Username into every request
// after the user has logged in via Cloudron's own login page.
// We never see passwords. In dev mode we fall back to 'devuser'.

app.use((req, res, next) => {
  const username = req.headers['x-cloudron-username'] || (IS_DEV ? 'devuser' : null);
  if (username) {
    req.session.user = { username };
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Auth routes ───────────────────────────────────────────────────────────────

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Firefly-III proxy ─────────────────────────────────────────────────────────

app.get('/api/firefly/*', requireAuth, async (req, res) => {
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
  console.log(`[server] Mode: ${IS_DEV ? 'DEV (devuser, no auth)' : 'PRODUCTION (Cloudron proxyAuth)'}`);
  console.log(`[server] Firefly target: ${FIREFLY_BASE_URL || '(not set)'}`);
});
