<p align="center"><img src="assets/logo.svg" width="96" height="96" alt="Pulse Logo"></p>

# Pulse · Monthly traffic and a compact dashboard

An independently maintained fork of [xhhcn/Pulse](https://github.com/xhhcn/Pulse) at [aoomee/Pulse](https://github.com/aoomee/Pulse), adding optional vnStat billing-cycle traffic and a refined frontend.

[中文](README.md) · [Download prerelease](https://github.com/aoomee/Pulse/releases/tag/v1.4.0-vnstat.3) · [Container image](https://github.com/aoomee/Pulse/pkgs/container/pulse) · [Build checks](https://github.com/aoomee/Pulse/actions/workflows/publish-fork.yml) · [MIT](LICENSE)

## Current version

`v1.4.0-vnstat.3` is a published **prerelease for deployment testing**. The public image supports Linux amd64 / arm64 and does not require a GHCR login.

```text
ghcr.io/aoomee/pulse:1.4.0-vnstat.3
```

Use the exact tag, not upstream `xhh1128/pulse` or `latest`. The default `main` branch contains the new source; deployments should use the release.

Verified: frontend build, Go tests/vet, server race tests, browser layout/motion regressions, and published amd64 container startup, health and page checks. The arm64 image is built; real VPS installation and long-running vnStat accounting across different interfaces still require validation. This is not a claim of zero defects.

## Changes

- Per-host monthly billing: upload only, download only, or both (default).
- Current-cycle calibration uses the latest stored counters as a baseline; only subsequent deltas are added. It expires next cycle or when changing billing mode.
- Human-readable monthly/reset-day badges replace the technical vnStat label.
- Fix Linux command copying, with a selectable command preview, root/sudo selection and HTTP clipboard fallback.
- Align newly added host names with the edit icon when OS information is not available yet.
- Optional vnStat billing-cycle traffic with reset days 1–28; unavailable monthly data falls back to interface totals.
- Per-server allowances with `500 GB / 1 TB` inside the meter, without a separate percentage.
- Legacy accounting displays only a total value, with no meter or total badge.
- Centered columns, consistent meters, no OS column on the homepage, and responsive reflow instead of horizontal scrolling.
- A gentle one-time entrance without replay on live updates; long names no longer overlap the copy button.

## Quick start with Docker

### 1. Check prerequisites

Linux quick-start commands below assume **root** and do not require `sudo`. Non-root users need appropriate permissions or `sudo`. Copy code only, one command at a time, without shell prompts or the Copy button label.

```bash
docker --version
docker compose version
```

If Docker is missing, install [Docker Engine](https://docs.docker.com/engine/install/) and the [Compose plugin](https://docs.docker.com/compose/install/) for your distribution first. Package names vary by release. Existing legacy installations may substitute `docker-compose` for `docker compose`; prefer the plugin for new installations.

### 2. Fresh deployment

Use a new directory on a host without a conflicting container. If the directory already exists, inspect it instead of overwriting an existing Compose file.

```bash
mkdir pulse
cd pulse
curl -fL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/docker-compose.yaml -o docker-compose.yaml
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://SERVER_IP:8008`. Visit `/admin` to set the initial administrator password. If unreachable, check the VPS security group/firewall for TCP 8008. Use an HTTPS reverse proxy for public access.

```bash
docker compose logs --tail=100
curl -fsS http://127.0.0.1:8008/healthz
```

### 3. Upgrade an existing deployment

Download a backup from the admin panel first. In the **original deployment directory**, change only `image` to the version above, retaining ports, container/project names and the original volume or bind mount at `/app/data`. Then run:

```bash
docker compose pull
docker compose up -d
```

**Do not run `docker compose down -v` or replace your existing data volume with an empty one.** The default named volume `pulse-data` receives a Compose project prefix; changing directories can connect to a different empty volume. Back up current data before rolling back an image, and never overwrite a running database.

## Enable monthly traffic

1. Add a machine in `/admin` and click its Linux icon.
2. Enable vnStat monthly traffic, choose a reset day (1–28), and optionally select an interface.
3. Select `root` or `sudo` above the command (default: root), then copy and run it on the monitored machine. The command box also supports manual selection and copying.
4. Edit the service to set its monthly GB/TB allowance; `500 GB` out of `1 TB` fills half the meter.

Usage defaults to **RX + TX**, with upload-only and download-only options in Edit service. Match your provider's billing direction. Quotas use decimal units (1 TB = 1000 GB). Empty/zero allowances show usage without a quota meter. Live network speed still comes from interface counters.

For a mid-cycle install, enter the provider's current usage (for example `854.71 GB`) in the optional calibration field, then Update service. This sets total usage, not an extra amount. The server atomically stores the cycle and latest vnStat baseline; subsequent deltas are added without double counting. Calibration expires on cycle changes, billing-mode changes or counter rollback. Blank preserves it, zero calibrates to zero, and Clear restores measured usage. Valid monthly data is required. Existing vnStat clients need no reinstall for this server upgrade. Provider sampling times and billing scope may still produce differences.

vnStat records traffic only after collection starts; it cannot recover earlier usage. Cycles follow the monitored machine’s local timezone and database writes may introduce a delay. Changing the reset day does not recalculate historical data. The installer changes `MonthRotate` in `/etc/vnstat.conf`, also affecting other vnStat users on that host. Windows/macOS retain the original accounting.

Generated installation commands and automatic updates are pinned to this release. Use a newer installer for future client upgrades.

## Standalone server without Docker

For Linux amd64/arm64 with systemd, `curl` and `wget`. Run as root for a fresh installation:

```bash
curl -fL https://raw.githubusercontent.com/aoomee/Pulse/main/install-pulse-server.sh -o install-pulse-server.sh
bash install-pulse-server.sh
```

The installer defaults to this fork’s `v1.4.0-vnstat.3`, with the binary at `/opt/pulse/pulse-server`, data at `/opt/pulse/data`, and port 8008. Do not run it alongside a Docker deployment on the same port. For an existing installation, back up first and stop `pulse-server` before running the installer.

```bash
systemctl status pulse-server
journalctl -u pulse-server -n 100
```

For manual installation, use the matching `pulse-server-standalone-linux-amd64` or `pulse-server-standalone-linux-arm64` asset from the [Release](https://github.com/aoomee/Pulse/releases/tag/v1.4.0-vnstat.3), which also contains clients, installers and `SHA256SUMS`.

---

## 🌐 Docker IPv6 Configuration

Pulse supports IPv4/IPv6 dual-stack. If your server requires IPv6 support, please follow these steps:

### Prerequisites

1. **Ensure the host has IPv6 enabled**
   ```bash
   # Check if IPv6 is enabled
   ip -6 addr show
   
   # Check if IPv6 forwarding is enabled
   sysctl net.ipv6.conf.all.forwarding
   # If output is 0, enable it:
   sudo sysctl -w net.ipv6.conf.all.forwarding=1
   
   # Enable permanently (edit /etc/sysctl.conf)
   echo "net.ipv6.conf.all.forwarding=1" | sudo tee -a /etc/sysctl.conf
   ```

2. **Configure Docker Daemon to enable IPv6**

   Edit or create `/etc/docker/daemon.json`:
   ```json
   {
     "ipv6": true,
     "fixed-cidr-v6": "fd00:dead:beef:c0::/80",
     "experimental": true,
     "ip6tables": true
   }
   ```
   
   > **Note**:
   > - `ipv6: true` - Globally enable Docker's IPv6 support (**required**)
   > - `fixed-cidr-v6` - IPv6 subnet range used by Docker (adjust according to your actual situation)
   > - `experimental: true` - Enable experimental features (required for some IPv6 features)
   > - `ip6tables: true` - Enable IPv6 iptables support (for network isolation and port mapping)
   
   Restart Docker service to apply the configuration:
   ```bash
   sudo systemctl restart docker
   ```

3. **Configure docker-compose.yaml to enable IPv6**

   Configure the network to enable IPv6 in `docker-compose.yaml`:
   ```yaml
   services:
     pulse:
       image: ghcr.io/aoomee/pulse:1.4.0-vnstat.3
       container_name: pulse-monitor
       ports:
         - 8008:8008
       volumes:
         - pulse-data:/app/data
       restart: unless-stopped
       networks:
         - pulse-network

   volumes:
     pulse-data:

   networks:
     pulse-network:
       enable_ipv6: true
       ipam:
         driver: default
   ```

4. **Recreate containers**

   ```bash
   docker compose down
   docker compose up -d
   ```

5. **Verify IPv6 configuration**

   ```bash
   # Check container IPv6 address
   docker exec pulse-monitor ip -6 addr show
   
   # Test IPv6 connectivity (if container has ping6)
   docker exec pulse-monitor ping6 -c 2 2001:4860:4860::8888
   ```

---

## 📦 Client Installation

### Linux

Run as root after replacing `YOUR_ID`, `SERVER_URL` and `YOUR_SECRET` with the values from your admin panel. Prefer the per-machine generated command to avoid mismatched credentials.

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/install.sh | bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET'
```

Linux clients can optionally use vnStat for current-month or billing-cycle traffic. Click the Linux icon beside a machine in the admin panel and enable “Monthly traffic with vnStat” to generate the command, or install it manually:

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/install.sh | bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET' --vnstat --traffic-reset-day 8
```

- `--traffic-reset-day` accepts `1`–`28` and rotates in the monitored machine's local timezone.
- `--vnstat-interface` is optional; the installer first tries to detect the default-route interface.
- The script installs vnStat with the Linux distribution's package manager and uses it only as an optional data source. If installation fails, the database is not ready, or vnStat cannot be read, the client automatically falls back to Pulse's original interface totals. Windows and macOS keep the original traffic mode.
- Set a per-machine monthly allowance (GB/TB) from “Edit Service” in the admin panel. For vnStat machines, the homepage shows a progress bar based on combined download and upload usage. Allowances use the decimal convention common to network plans (1 TB = 1000 GB); leave the field empty or set it to 0 to show usage without a percentage.

### macOS (Intel / Apple Silicon)

The install script auto-detects CPU architecture and registers the service as a `launchd` daemon (auto-starts on boot):

```bash
curl -fsSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/install.sh | sudo bash -s -- --id 'YOUR_ID' --server 'SERVER_URL' --secret 'YOUR_SECRET'
```

> **Note**: macOS requires `sudo` to write `.plist` files into `/Library/LaunchDaemons/`.

**macOS service management commands:**

```bash
# Check status
sudo launchctl print system/com.pulse.client

# View logs
tail -f /var/log/pulse-client.log

# Restart service (recommended)
sudo launchctl kickstart -k system/com.pulse.client

# Stop service
sudo launchctl bootout system/com.pulse.client

# Start a stopped service again
sudo launchctl bootstrap system /Library/LaunchDaemons/com.pulse.client.plist
```

### Windows (Administrator PowerShell)

```powershell
$env:AgentId = 'YOUR_ID'
$env:ServerBase = 'SERVER_URL'
$env:Secret = 'YOUR_SECRET'
irm https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/install.ps1 | iex
```

| Parameter | Description |
|------|------|
| `<ID>` | Unique server identifier (set when adding system in admin panel) |
| `<SERVER_URL>` | Server URL, e.g., `http://your-server:8008` |
| `<SECRET>` | Authentication secret (auto-generated after adding system in admin panel, viewable in system details) |

> **Note**: The `--secret` parameter is optional. If the server system is configured with a secret, you must provide the correct secret to register successfully.

### Uninstall Client

> The client enables auto-update by default, so on systemd you also get `pulse-client-update.service` + `pulse-client-update.timer` alongside `pulse-client.service`, and on macOS an extra `com.pulse.client.update` launchd job. The commands below clean those up too — they are safe to run regardless of whether auto-update was enabled (missing units are silently ignored).

**Linux (systemd):**
```bash
sudo systemctl stop pulse-client pulse-client-update.timer 2>/dev/null
sudo systemctl disable pulse-client pulse-client-update.timer 2>/dev/null
sudo rm -f /opt/pulse/probe-client /opt/pulse/update.sh \
  /etc/systemd/system/pulse-client.service \
  /etc/systemd/system/pulse-client-update.service \
  /etc/systemd/system/pulse-client-update.timer
sudo systemctl daemon-reload
```
> If the same machine also runs Pulse server, keep `/opt/pulse/` (only delete the client-specific files listed above) — the database is untouched.

**macOS (with auto-update):**
```bash
sudo launchctl bootout system/com.pulse.client 2>/dev/null || true
sudo launchctl bootout system/com.pulse.client.update 2>/dev/null || true
sudo rm -rf /opt/pulse \
  /Library/LaunchDaemons/com.pulse.client.plist \
  /Library/LaunchDaemons/com.pulse.client.update.plist
```

**Windows (Administrator PowerShell):**
```powershell
Stop-ScheduledTask -TaskName 'PulseClient' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PulseClient' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Pulse Monitoring Client*' -ErrorAction SilentlyContinue; Remove-Item -Path "$env:ProgramFiles\Pulse" -Recurse -Force -ErrorAction SilentlyContinue
```

---

## ⚙️ Usage

1. Access `http://YOUR_IP:8008/admin` to enter the admin panel
2. Set admin password on first visit
3. Click **Add System** to add a server
4. After adding a system, a **Secret** (authentication key) will be automatically generated
5. Run the client installation command on the target machine, **must include the correct Secret**
6. Data is automatically reported and displayed in real-time

> **Tip**: In the admin panel's system list, click the copy button on the right side of the system to quickly copy the installation command with Secret.

---

## 📊 Monitoring Metrics

| Metric | Content |
|------|------|
| **CPU** | Usage, cores, model |
| **Memory** | Usage, total |
| **Disk** | Usage, total |
| **Network** | Upload/download speed, TCPing latency |
| **System** | Uptime, IP, location |

---

## 🎨 Theming & Customisation

Pulse's frontend is an Astro project. Styling, layout and presentation of existing data can be changed under `server/web/`. New accounting capabilities may also require agent and Go API changes: this fork's vnStat feature includes collection and reporting, not just theme-side calculation.

### Where the theme code lives

```
server/web/
├── src/
│   ├── pages/                    # Three route entries
│   │   ├── index.astro           #   /        public dashboard
│   │   ├── admin.astro           #   /admin   admin panel
│   │   └── login.astro           #   /login   login page
│   ├── components/               # 9 reusable components, Astro + Tailwind throughout
│   │   ├── SystemTable.astro     #     main table + TCPing chart
│   │   ├── AdminDashboard.astro  #     admin tables + modals
│   │   ├── NavBar.astro / Footer.astro / LoadingState.astro
│   │   ├── LoginForm.astro / Icon.astro
│   │   └── SystemTableHeader.astro / SystemTableHeaderRow.astro
│   ├── styles/global.css         # global animations + custom Tailwind utilities
│   └── utils/i18n.ts             # English / Chinese strings (48 keys); add a language by extending the Language type
├── tailwind.config.mjs           # color palette + dark-mode config
└── astro.config.mjs              # Astro / Vite config (includes the dev proxy, see below)
```

### Local dev workflow

```bash
git clone https://github.com/aoomee/Pulse.git
cd Pulse/server

# Generate files required by Go embed first (Go 1.22+, Node.js and npm required)
cd web
npm ci
npm run build
cd ..

# Terminal 1: run the backend on :8080
go run .

# Terminal 2: from the repository root, run the frontend on :4321
cd server/web
npm run dev
```

Open `http://localhost:4321` and you'll get a live-reloading dashboard. `astro.config.mjs` already proxies `/api/*` and `/healthz` over to `:8080`, so **no fetch URLs need to change**. To work against a remote backend (e.g. your VPS instance):

```bash
PULSE_API_BASE=https://your-pulse-instance.example.com npm run dev
```

### Build & deploy

Build a standalone binary or Docker image from source. Run cross-compiled binaries on the corresponding target platform:

**A. Standalone binary (build the frontend first, then `go build`):**

```bash
# 1) Frontend bundle (produces server/web/dist/)
cd server/web && npm run build

# 2) Go build embeds the dist via embed.FS; switch GOOS/GOARCH to cross-compile
cd ..    # back to server/
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o pulse-server .

# 3) Run it (database lands in ./data/metrics.db)
./pulse-server
```

> The frontend must be built first: `go:embed all:web/dist` is a **compile-time** directive, so Go fails the build if `dist/` is missing.

**B. Docker image (single command — the image builds the frontend internally):**

```bash
docker build -t my-pulse:dev .
docker run --rm -p 8008:8008 -v "$(pwd)/data:/app/data" my-pulse:dev
```

The multi-stage `Dockerfile` runs `npm ci && npm run build` for you, hands the dist/ to nginx, and only the API surface goes through the Go backend. After modifying your theme locally, a single `docker build` rebuilds everything — no separate `npm run build` step needed.

### What you don't need to touch

* `server/main.go` & `server/store.go`: backend API, auth and bbolt storage; usually unchanged for purely visual theme work.
* `client/`: agent code running on monitored machines.
* `scripts/`, `install-pulse-server.sh`, `docker/`: deployment & ops.

### Upstreaming

Pure re-skins are best kept on your own fork. If you build something with general utility (a new component, a new filter, a bug fix), PRs back to upstream are welcome.

---

## 🚚 Migrating to Another Server

All of Pulse's server state (registered systems, shared secrets, TCPing history, admin password, dashboard config, …) lives in **one bbolt file**. The repo ships `scripts/migrate.sh`, which wraps the entire migration into **a single command** — run it on the new server and it pulls everything across from the old one. The old server can remain online during backup; the snapshot reflects one point in time, and subsequent writes are not automatically synchronized.

> Every client keeps its `AGENT_ID` / `SECRET`; the only thing that might need updating is `SERVER_BASE` (the URL).  
> If the old host sits behind a domain + reverse proxy, flip DNS to the new IP and clients need no change at all.

### ✨ One command end-to-end

```bash
# ── On the NEW server ──

# 1) Install Pulse (pick one)
#    A. Standalone binary (systemd) — recommended, lowest overhead
#       The installer also drops backup/restore/migrate into /opt/pulse/scripts/
#       and creates the pulse-migrate / pulse-backup / pulse-restore commands.
curl -fsSL https://raw.githubusercontent.com/aoomee/Pulse/main/install-pulse-server.sh | sudo bash

#    B. Docker Compose
# mkdir pulse && cd pulse && \
# curl -sSL https://github.com/aoomee/Pulse/releases/download/v1.4.0-vnstat.3/docker-compose.yaml -o docker-compose.yaml && \
# docker compose up -d && \
# curl -fsSL https://raw.githubusercontent.com/aoomee/Pulse/v1.4.0-vnstat.3/scripts/migrate.sh -o migrate.sh && chmod +x migrate.sh
#       migrate.sh will auto-fetch its backup.sh/restore.sh siblings from the repo — one file is enough.

# 2) One command — prompts for the OLD admin password (never shown on screen)
sudo pulse-migrate --from https://OLD_HOST                 # binary install (simplest)
# or, in the Docker directory:
# sudo ./migrate.sh --from https://OLD_HOST

# Non-interactive (CI / automation — use an env var, not an argv flag):
# sudo PASSWORD='OldAdminPW' pulse-migrate --from https://OLD_HOST -y
```

`migrate.sh` performs, in order:

1. Log in to the **old server** with the password you supplied and exchange it for a one-shot admin token. The password is piped to `curl` via stdin, so it never shows up in `ps`.
2. Call `GET /api/admin/backup` to pull a **transactionally-consistent** hot snapshot — built on bbolt's `Tx.WriteTo` inside a read-only transaction, so it can never capture a half-written page. **The old server is never stopped.**
3. Validate the downloaded file (size + bbolt magic number `0xEDDA0CED`) so a truncated `scp` or a still-gzipped archive is caught *before* anything destructive runs.
4. Auto-detect whether the new server runs under **Docker Compose** or **systemd (standalone binary)**, stop it, save the current `metrics.db` as `metrics.db.pre-restore-<timestamp>` (so rollback is a single command), install the snapshot, and restart.
5. Poll `/healthz` until it returns 200, or print logs + rollback instructions on a 60-second timeout.

By default the downloaded snapshot is staged in a `0700` private `mktemp` directory with the file itself at `0600`, and is deleted after a successful restore. Pass `--keep-backup ./pulse-backup.db` to also keep an offline copy.

### 💾 Prefer a one-click manual backup? Use the admin panel

Log in to `/admin` and look at the top-right icon bar — there is a new **Download Backup** button (download icon, emerald hover). Click once and the browser saves `pulse-backup-<UTC-timestamp>.db`. The file is byte-for-byte the **same consistent hot snapshot** `pulse-backup` / `migrate.sh` pull over the CLI (backed by bbolt's `Tx.WriteTo`), so you can feed it straight into `sudo pulse-restore <file>` on any fresh host. Handy when you have no SSH, want an ad-hoc backup before a risky change, or just want an extra safety copy before a migration.

### 🔐 Security notes (30-second read)

- **Use HTTPS or an SSH tunnel.** The snapshot carries the admin password hash and every per-system shared secret — shipping it over plaintext HTTP across the internet is as good as publishing your keys. The script warns on non-localhost `http://`. If you don't have HTTPS on the old host:
  ```bash
  ssh -fN -L 8008:localhost:8008 user@OLD_HOST
  sudo pulse-migrate --from http://localhost:8008
  ```
- **Avoid `--password 'plaintext'`.** Argv is visible to every local user via `ps`. Prefer the interactive prompt (no flag) or the `PASSWORD=...` environment variable.
- **Treat the backup file as the live DB.** Keep it `0600` (the script does), move it over an encrypted channel, and delete it when you're done.
- **The server already does the heavy lifting**: 5 failed logins → IP locked for 15 min, bcrypt password hashing, `/api/admin/backup` accepts **only** `Authorization: Bearer` (no `?token=` query, to keep tokens out of nginx access logs and shell history), and every backup pull writes an audit log line including the caller's IP.

### 🔁 Repoint clients (only if the URL actually changed)

```bash
# Linux (systemd client)
sudo sed -i 's#http://OLD_HOST:8008#http://NEW_HOST:8008#g' \
  /etc/systemd/system/pulse-client.service
sudo systemctl daemon-reload && sudo systemctl restart pulse-client
```

### 🛡️ Rollback

The previous `metrics.db` is preserved as `metrics.db.pre-restore-<timestamp>`, so one command reverts the migration:

```bash
# Standalone binary
sudo systemctl stop pulse-server
sudo cp /opt/pulse/data/metrics.db.pre-restore-* /opt/pulse/data/metrics.db
sudo systemctl start pulse-server

# Docker
docker compose stop
cp datatz/metrics.db.pre-restore-* datatz/metrics.db
docker compose up -d
```

Once you've verified `/admin` login works, the system list is complete, and TCPing charts render, delete the `.pre-restore-*` files.

### 📅 Bonus: periodic backups

The same scripts make good cron fodder for zero-downtime backups (env var keeps the password out of `ps`):

```bash
# Daily at 03:00 UTC
0 3 * * * PASSWORD='YourAdminPW' /opt/pulse/scripts/backup.sh \
  --server http://127.0.0.1:8008 \
  --output /var/backups/pulse/pulse-$(date -u +\%Y\%m\%d).db
```

### ⚠️ Gotchas

- **The backup file is the keys to the kingdom.** It embeds every per-system shared secret and the admin password hash. Treat it with the same care you'd treat the live DB — file permissions, transport encryption.
- **Never run two servers against the same client fleet.** Each client will report to whichever server answers first, so data will split across them. Take the old host offline once the new one is verified.
- **Full flag references**: `pulse-migrate --help`, `pulse-backup --help`, `pulse-restore --help` (or run the underlying `/opt/pulse/scripts/*.sh --help`).

---

## ✨ New Features

- Privacy Mode
- Logo and Name Customization
- CPU Type Detection
- One-Click Client Deployment

---

## 📄 License

[MIT](LICENSE)
