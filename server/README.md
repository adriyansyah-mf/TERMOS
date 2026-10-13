# termos-server

Self-hosted backend for Termos: vault sync between devices, team vaults, and live terminal sharing.

## What the server can and cannot see

Everything in your vault (hosts, passwords, keys, snippets) is encrypted on your device before it is sent. The server stores:

| Stored | Readable by the server |
|---|---|
| Username, device names, team names, team membership | Yes |
| Record ids, timestamps, deleted flag | Yes |
| Record contents (host, password, key, …) | No: XChaCha20-Poly1305 ciphertext |
| Your password | Never sent. The app derives two keys with Argon2id; only the login key is sent, and the server stores a scrypt hash of it |
| Shared terminal output | No: encrypted with a key that only exists in the share link |

Consequence: if you forget your account password, the server admin cannot recover your synced vault. Your local vault on each device keeps working.

## Run with Docker

```sh
cd server
docker compose up -d --build
curl http://127.0.0.1:8080/api/status
```

Data lives in `./data/termos.db` (SQLite). Back up that file.

The compose file binds to `127.0.0.1` only. To use it from other machines, put HTTPS in front:

- **Caddy** (simplest): copy `Caddyfile.example`, set your domain, run Caddy. It handles certificates.
- **Proxmox / LAN only**: run it in an LXC or VM and use a reverse proxy you already have (Nginx Proxy Manager, Traefik). Plain HTTP is accepted by the app only for `localhost` and private LAN addresses.

## Run without Docker

Needs Node.js 22.5 or newer (uses the built-in `node:sqlite`).

```sh
cd server
npm ci
npm run build
TERMOS_DB=/var/lib/termos/termos.db node dist/index.js
```

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `TERMOS_PORT` | `8080` | Listen port |
| `TERMOS_HOST` | `0.0.0.0` | Listen address |
| `TERMOS_DB` | `./data/termos.db` | SQLite file |
| `TERMOS_SIGNUP` | `first` | `first`: only the first account can sign up and becomes admin. `invite`: sign up needs `TERMOS_INVITE_CODE`. `open`: anyone can sign up |
| `TERMOS_INVITE_CODE` | | Required when `TERMOS_SIGNUP=invite` |
| `TERMOS_TRUST_PROXY` | `0` | `1` to read the client IP from `X-Forwarded-For` (set this behind a reverse proxy) |

Typical setup for a small team: start with `first`, create your own account from the app, then switch to `invite`, restart, and give teammates the code.

## Connecting the app

Termos, Settings, Sync: enter the server URL (for example `https://termos.example.com`), a username and the account password, then **Daftar** (first time) or **Masuk**.

## API

All endpoints are JSON under `/api`. Authenticated calls use `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Signup mode, user count |
| POST | `/prelogin` | KDF parameters for a username (fake but stable for unknown names) |
| POST | `/register`, `/login`, `/logout` | Accounts and device tokens |
| POST | `/password` | Change password (re-wrapped keys); signs out other devices |
| GET/DELETE | `/devices`, `/devices/:id` | List and revoke devices |
| GET/POST | `/sync?since=N[&scope=…]` | Pull / push encrypted records (last writer wins) |
| GET/POST/DELETE | `/teams`, `/teams/:id`, `/teams/:id/members[/:userId]` | Team vaults |
| GET | `/users/:username/key` | Public key for sealing a team key to a new member |
| WS | `/share/host`, `/share/join/:id` | Live terminal sharing relay |

## Tests

```sh
npm test
```

Known limits:

- Removing a team member stops their access to new syncs, but anything they already downloaded stays on their device, and the team key is not rotated. Create a new team if you need to fully cut someone off.
