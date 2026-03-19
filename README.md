# Firefly Dashboard

A custom dashboard UI for [Firefly-III](https://www.firefly-iii.org/), designed to run as a
**packaged Cloudron app** with Cloudron SSO (LDAP) and a better permissions model than the
default Firefly interface.

**Current state:** read-only dashboard — asset account balances + recent transactions.
Auth via Cloudron LDAP. The Firefly API token lives only on the server, never in the browser.

---

## Architecture (30 seconds)

```
Browser → React (Vite) → Express backend → Firefly-III API
                                ↑
                        Cloudron LDAP auth
```

| Folder | What it does |
|---|---|
| `client/` | React + Vite + Tailwind frontend |
| `server/` | Node.js/Express: login (LDAP), session, Firefly proxy |
| `Dockerfile` | Multi-stage build → single container |
| `CloudronManifest.json` | Tells Cloudron: port, addons, env vars |
| `Makefile` | All commands a solo dev needs |

---

## Local dev (no Docker, no Cloudron needed)

### Windows setup (one-time)

Windows requires WSL (Windows Subsystem for Linux). Open **PowerShell** and run:

```powershell
wsl --install
```

Restart your PC. Then open **Ubuntu** from the Start menu — this is your terminal from now on.

Install Node.js inside Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs make
```

Your Windows files are accessible at `/mnt/c/Users/YourName/...` inside Ubuntu.

### Start developing

```bash
cp .env.example .env
# edit .env → set FIREFLY_BASE_URL and FIREFLY_TOKEN

make dev
# backend → http://localhost:3000
# frontend → http://localhost:5173  (hot reload, open this in your browser)
```

In dev mode LDAP is skipped — any non-empty username + password works.
The Vite dev server proxies all `/api/*` calls to the Express backend automatically.

### Picking it up again later

```bash
# Open Ubuntu from Start menu, navigate to project, then:
make dev
```

---

## Deploy to Cloudron

### One-time setup

```bash
# 1. Point to your Cloudron registry in .env:
#    CLOUDRON_REGISTRY=registry.your-cloudron.example.com
#    CLOUDRON_APP=firefly-ui
#    CLOUDRON_HOST=your-cloudron.example.com

# 2. Login to the registry (once per machine):
make login

# 3. Build + push + install:
make release
make deploy
```

### Set environment variables in Cloudron

After install go to: **Cloudron → your app → Settings → Environment Variables**

| Variable | Value |
|---|---|
| `FIREFLY_BASE_URL` | `https://firefly.your-cloudron.example.com` |
| `FIREFLY_TOKEN` | Personal Access Token from Firefly → Profile → OAuth |
| `SESSION_SECRET` | Random string — run `openssl rand -hex 32` |

### Subsequent deploys (after code changes)

```bash
make release   # build + push
make update    # Cloudron pulls new image
```

### Other useful commands

```bash
make logs      # tail live app logs
make restart   # restart app without rebuild
make help      # show all commands
```

---

## Project structure

```
firefly-dashboard/
├── CloudronManifest.json     # Cloudron packaging config
├── Dockerfile                # Multi-stage build
├── Makefile                  # All dev + deploy commands
├── .env.example              # Copy to .env for local dev
├── server/
│   ├── index.js              # Express: auth + Firefly proxy
│   └── package.json
└── client/
    ├── src/
    │   ├── App.jsx           # Routing + auth guard
    │   ├── api.js            # All fetch calls (auth + firefly.*)
    │   └── pages/
    │       ├── LoginPage.jsx
    │       └── DashboardPage.jsx
    └── vite.config.js        # Dev proxy → :3000
```

---

## Roadmap / next steps

- [ ] Budget overview panel
- [ ] Transaction entry (write to Firefly API)
- [ ] Charts (spending over time, category breakdown)
- [ ] Per-user Firefly token instead of single service token
- [ ] Mobile layout polish
- [ ] Persistent sessions (mount `/app/data` in Cloudron)

---

## Firefly-III API reference

Full API docs: https://api-docs.firefly-iii.org/

The backend proxies `GET /api/firefly/*` → `FIREFLY_BASE_URL/api/v1/*`
To add a new data source: add a method in `client/src/api.js` — that's it.
