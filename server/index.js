'use strict';

const express = require('express');
const session = require('express-session');
const LdapAuth = require('ldapauth-fork');
const fetch = require('node-fetch');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const FIREFLY_BASE_URL = (process.env.FIREFLY_BASE_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

// Cloudron injects these when the "ldap" addon is declared in the manifest
const LDAP_URL = process.env.CLOUDRON_LDAP_URL;
const LDAP_USERS_BASE = process.env.CLOUDRON_LDAP_USERS_BASE_DN;
const LDAP_BIND_DN = process.env.CLOUDRON_LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.CLOUDRON_LDAP_BIND_PASSWORD;

const IS_DEV = process.env.NODE_ENV !== 'production';

// ── LDAP ──────────────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves to the LDAP user object, or rejects on bad credentials.
 * In local dev (no LDAP env vars set) any username/password is accepted so you can
 * iterate without a running Cloudron instance.
 */
function ldapAuthenticate(username, password) {
  if (!LDAP_URL) {
    // Dev fallback: accept any non-empty credentials
    console.warn('[auth] LDAP not configured — dev mode, accepting any credentials');
    return Promise.resolve({ uid: username, cn: username });
  }

  return new Promise((resolve, reject) => {
    const ldap = new LdapAuth({
      url: LDAP_URL,
      bindDN: LDAP_BIND_DN,
      bindCredentials: LDAP_BIND_PASSWORD,
      searchBase: LDAP_USERS_BASE,
      searchFilter: '(uid={{username}})',
      reconnect: true,
    });

    ldap.authenticate(username, password, (err, user) => {
      ldap.close(() => {});
      if (err) return reject(err);
      resolve(user);
    });
  });
}

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Session store — SQLite via knex so sessions survive server restarts inside the container.
// For a proper Cloudron app you'd mount /app/data and store the db there.
const KnexSessionStore = require('connect-session-knex')(session);
const knex = require('knex')({
  client: 'better-sqlite3',
  connection: { filename: '/tmp/sessions.db' },
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
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Auth routes ───────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  try {
    const user = await ldapAuthenticate(username, password);
    req.session.user = { username: user.uid || user.sAMAccountName || username };
    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error('[auth] login failed:', err.message);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session?.user) return res.json({ user: req.session.user });
  res.status(401).json({ error: 'Not authenticated' });
});

// ── Health check (Cloudron calls this) ───────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Firefly-III proxy ─────────────────────────────────────────────────────────
//
// All Firefly API calls go through here so the token is never in the browser.
// Route: GET/POST /api/firefly/*  →  FIREFLY_BASE_URL/api/v1/*
//
// Currently only GET is implemented (read-only phase).

app.get('/api/firefly/*', requireAuth, async (req, res) => {
  if (!FIREFLY_BASE_URL || !FIREFLY_TOKEN) {
    return res.status(503).json({ error: 'Firefly not configured (set FIREFLY_BASE_URL and FIREFLY_TOKEN)' });
  }

  // Strip the /api/firefly prefix and forward to Firefly's v1 API
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

// SPA fallback — all non-API routes return index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] Firefly target: ${FIREFLY_BASE_URL || '(not set)'}`);
  console.log(`[server] LDAP: ${LDAP_URL || '(dev mode — no LDAP)'}`);
});
