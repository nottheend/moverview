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

// Cloudron injects these when "oidc" addon is declared in the manifest.
// In local dev these are not set, so we use a dev-user bypass instead.
const OIDC_ISSUER        = process.env.CLOUDRON_OIDC_ISSUER;
const OIDC_CLIENT_ID     = process.env.CLOUDRON_OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.CLOUDRON_OIDC_CLIENT_SECRET;
const OIDC_CALLBACK_URL  = process.env.CLOUDRON_OIDC_CALLBACK_URL; // injected by Cloudron

const IS_DEV = !OIDC_ISSUER; // true when running locally without Cloudron

// ── Session store ─────────────────────────────────────────────────────────────

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
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ── Dev mode: auto-login as a fake user ──────────────────────────────────────
//
// When running locally (no OIDC env vars), we skip the login screen entirely.
// Every request is automatically treated as "devuser". This means you can
// work on the dashboard UI without any auth setup.

if (IS_DEV) {
  console.warn('[auth] DEV MODE — auto-login enabled, no login screen');
  app.use((req, res, next) => {
    req.session.user = { username: 'devuser', email: 'dev@localhost' };
    next();
  });
}

// ── OIDC auth routes (production / Cloudron only) ────────────────────────────
//
// How Cloudron OIDC works:
//   1. User visits the app → not logged in → we redirect to Cloudron's login page
//   2. User logs in on Cloudron (SSO, 2FA etc. all handled there)
//   3. Cloudron redirects back to /api/auth/callback with a code
//   4. We exchange that code for user info, store it in the session
//
// The user never enters their password in our app. Cloudron handles everything.

if (!IS_DEV) {
  const { Issuer, generators } = require('openid-client');

  let oidcClient; // initialised once on first request

  async function getOidcClient() {
    if (oidcClient) return oidcClient;
    const issuer = await Issuer.discover(OIDC_ISSUER);
    oidcClient = new issuer.Client({
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
      redirect_uris: [OIDC_CALLBACK_URL],
      response_types: ['code'],
    });
    return oidcClient;
  }

  // Step 1 — redirect user to Cloudron login
  app.get('/api/auth/login', async (req, res) => {
    const client = await getOidcClient();
    const state = generators.state();
    const nonce = generators.nonce();
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    const url = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
    });
    res.redirect(url);
  });

  // Step 2 — Cloudron redirects back here after login
  app.get('/api/auth/callback', async (req, res) => {
    try {
      const client = await getOidcClient();
      const params = client.callbackParams(req);
      const tokenSet = await client.callback(OIDC_CALLBACK_URL, params, {
        state: req.session.oidcState,
        nonce: req.session.oidcNonce,
      });
      const userinfo = await client.userinfo(tokenSet);
      req.session.user = {
        username: userinfo.preferred_username || userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
      };
      res.redirect('/');
    } catch (err) {
      console.error('[auth] OIDC callback failed:', err.message);
      res.status(401).send('Login failed: ' + err.message);
    }
  });

  // Protected routes redirect to login instead of returning 401
  app.use((req, res, next) => {
    if (req.session?.user) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.redirect('/api/auth/login');
  });
}

// ── Shared auth routes ────────────────────────────────────────────────────────

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
// Route: GET /api/firefly/*  →  FIREFLY_BASE_URL/api/v1/*

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
  console.log(`[server] Mode: ${IS_DEV ? 'DEV (auto-login, no OIDC)' : 'PRODUCTION (Cloudron OIDC)'}`);
  console.log(`[server] Firefly target: ${FIREFLY_BASE_URL || '(not set)'}`);
});
