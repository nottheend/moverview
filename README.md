# Firefly Dashboard

A custom dashboard UI for [Firefly-III](https://www.firefly-iii.org/), designed to run as a
**packaged Cloudron app** with Cloudron proxyAuth single sign-on.

**Current state:** read-only dashboard — asset account balances + recent transactions.
Auth via Cloudron proxyAuth (true SSO — users are already logged in from the Cloudron dashboard).
The Firefly API token lives only on the server, never in the browser.

---

## Architecture (30 seconds)

```
Browser → React (Vite) → Express backend → Firefly-III API
                                ↑
                        Cloudron proxyAuth (SSO)
```

| Folder | What it does |
|---|---|
| `client/` | React + Vite + Tailwind frontend |
| `server/` | Node.js/Express: auth header, session, Firefly proxy |
| `Dockerfile` | Multi-stage build → single container |
| `CloudronManifest.json` | Tells Cloudron: port, addons |
| `Makefile` | All commands a solo dev needs |

---

## Auth: how it works

**In production (Cloudron):** Cloudron's `proxyAuth` addon puts its own login wall in front
of the app. After login, Cloudron injects `X-Cloudron-Username` into every request. Our app
reads that header — it never sees a password.

**In local dev:** The header won't exist, so the server automatically uses `devuser`. You go
straight to the dashboard with no login screen. Just `make dev` and open the browser.

---

## Local dev (no Docker, no Cloudron needed)

### Windows setup (one-time)

Open **PowerShell** and run:

```powershell
wsl --install
```

Restart your PC. Open **Ubuntu** from the Start menu — this is your terminal from now on.

Install Node.js, make, and wslu inside Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs make wslu
```

Your Windows files are at `/mnt/c/Users/YourName/...` inside Ubuntu.

### Start developing

```bash
cp .env.example .env
# edit .env → set FIREFLY_BASE_URL and FIREFLY_TOKEN

make dev
# open http://localhost:5173 — logged in automatically as devuser
```

### Picking it up again later

```bash
# Open Ubuntu from Start menu, navigate to project:
cd /mnt/c/Users/YourName/path/to/firefly-dashboard
make dev
```

---

## Deploy to Cloudron

### One-time: login to Cloudron CLI

The Cloudron CLI has a version mismatch problem on WSL:
- **Latest CLI** needs a browser to login — WSL has no browser
- **cloudron@6** supports username/password login but can't deploy with `--image`

**Solution: use both versions — login with v6, then switch to latest for deploying.**

```bash
# Step 1 — login with v6 (no browser needed)
sudo npm install -g cloudron@6
cloudron login my.nottheend.info -u youruser -p 'yourpassword'

# Step 2 — switch to latest for deploying
sudo npm install -g cloudron
```

The login session is saved to disk and survives the version switch.

> If this breaks in the future: update Cloudron itself, then the latest CLI's browser login
> will work via `wslview` (wslu is already installed above).

### One-time: login to Docker registry + deploy

```bash
# Fill in .env first:
#   CLOUDRON_REGISTRY=registry.your-cloudron.example.com
#   CLOUDRON_APP=moverview.yourdomain.com          # app location
#   FIREFLY_BASE_URL=https://firefly.yourdomain.com
#   FIREFLY_TOKEN=your-token

make login     # login to your Cloudron Docker registry
make release   # build + push image
make deploy    # install on Cloudron
```

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
├── CloudronManifest.json     # Cloudron packaging (proxyAuth addon)
├── Dockerfile                # Multi-stage build
├── Makefile                  # All dev + deploy commands
├── .env.example              # Copy to .env for local dev
├── server/
│   ├── index.js              # Express: auth header + Firefly proxy
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
