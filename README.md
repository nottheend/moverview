# Firefly Dashboard

A custom dashboard UI for [Firefly-III](https://www.firefly-iii.org/), designed to run as a
**packaged Cloudron app** with Cloudron OIDC single sign-on.

**Current state:** read-only dashboard — asset account balances + recent transactions.
Auth via Cloudron OIDC (true SSO — users are already logged in from the Cloudron dashboard).
The Firefly API token lives only on the server, never in the browser.

---

## Architecture (30 seconds)

```
Browser → React (Vite) → Express backend → Firefly-III API
                                ↑
                        Cloudron OIDC (SSO)
```

| Folder | What it does |
|---|---|
| `client/` | React + Vite + Tailwind frontend |
| `server/` | Node.js/Express: OIDC auth, session, Firefly proxy |
| `Dockerfile` | Multi-stage build → single container |
| `CloudronManifest.json` | Tells Cloudron: port, addons, env vars |
| `Makefile` | All commands a solo dev needs |

---

## Auth: how it works

**In production (Cloudron):** Cloudron injects OIDC credentials automatically. Users are
redirected to the Cloudron login page if not already logged in — our app never sees their
password. True SSO: if already logged into Cloudron, they go straight to the dashboard.

**In local dev:** OIDC is skipped entirely. The server auto-logs you in as `devuser` so
you go straight to the dashboard with no login screen. Just `make dev` and open the browser.

---

## Local dev (no Docker, no Cloudron needed)

### Windows setup (one-time)

Open **PowerShell** and run:

```powershell
wsl --install
```

Restart your PC. Open **Ubuntu** from the Start menu — this is your terminal from now on.

Install Node.js and make inside Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs make
```

Your Windows files are at `/mnt/c/Users/YourName/...` inside Ubuntu.

### Start developing

```bash
cp .env.example .env
# edit .env → set FIREFLY_BASE_URL and FIREFLY_TOKEN

make dev
# open http://localhost:5173 — you are logged in automatically as devuser
```

### Picking it up again later

```bash
# Open Ubuntu from Start menu, navigate to project:
cd /mnt/c/Users/YourName/path/to/firefly-dashboard
make dev
```

---

## Deploy to Cloudron

### One-time setup

```bash
# 1. Fill in .env:
#    CLOUDRON_REGISTRY=registry.your-cloudron.example.com
#    CLOUDRON_APP=firefly-ui
#    CLOUDRON_HOST=your-cloudron.example.com

make login     # login to your Cloudron registry (once per machine)
make release   # build + push image
make deploy    # install on Cloudron
```

### Set environment variables in Cloudron

After install: **Cloudron → your app → Settings → Environment Variables**

| Variable | Value |
|---|---|
| `FIREFLY_BASE_URL` | `https://firefly.your-cloudron.example.com` |
| `FIREFLY_TOKEN` | Firefly → Profile → OAuth → Personal Access Tokens |
| `SESSION_SECRET` | Run `openssl rand -hex 32` and paste the result |

Cloudron injects the OIDC variables automatically — you don't set those manually.

### Subsequent deploys

```bash
make release   # build + push
make update    # Cloudron pulls new image
```

### Other useful commands

```bash
make logs      # tail live app logs
make restart   # restart without rebuild
make help      # show all commands
```

---

## Project structure

```
firefly-dashboard/
├── CloudronManifest.json     # Cloudron packaging (oidc addon declared here)
├── Dockerfile                # Multi-stage build
├── Makefile                  # All dev + deploy commands
├── .env.example              # Copy to .env for local dev
├── server/
│   ├── index.js              # Express: OIDC auth + Firefly proxy
│   └── package.json
└── client/
    ├── src/
    │   ├── App.jsx           # Auth state + routing
    │   ├── api.js            # All fetch calls (auth + firefly.*)
    │   └── pages/
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
To add a new endpoint: add a method to `client/src/api.js` — that's it.
