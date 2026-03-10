# Cosmo setup on WSL

This guide follows the standard Cosmo setup steps with **WSL-specific notes**. Run all commands from your WSL terminal (e.g. Ubuntu).

## 1. Clone the repo

```bash
git clone https://github.com/wundergraph/cosmo.git
cd cosmo
```

## 2. Prerequisites (in WSL)

Install and verify:

| Tool | Version | Install / check |
|------|---------|-----------------|
| **Go** | ≥ 1.25 | `sudo apt install golang-go` or [go.dev/dl](https://go.dev/dl/). Ensure `$HOME/go/bin` is on PATH: `export PATH="$PATH:$(go env GOPATH)/bin"` (add to `~/.bashrc` or `~/.zshrc`) |
| **Node.js** | ≥ 22.11.0 | `nvm install 22 && nvm use 22` (install [nvm](https://github.com/nvm-sh/nvm) first if needed) |
| **pnpm** | 9 | `npm install -g pnpm@9` |
| **Docker** | Engine + Compose V2 | Use **Docker Desktop for Windows** with WSL 2 backend, or [Docker Engine inside WSL](https://docs.docker.com/desktop/wsl/). From WSL, run `docker -v` and `docker compose version` |

Quick check:

```bash
go version
node -v   # expect v22.x
pnpm -v  # expect 9.x
docker -v
docker compose version
```

## 3. Copy environment files

```bash
cp controlplane/.env.example controlplane/.env
cp studio/.env.local.example studio/.env.local
cp cli/.env.example cli/.env
```

Edit the files if you need to change defaults (e.g. ports or URLs).

## 4. Docker: enable host networking

**Why:** Keycloak rejects non-HTTPS traffic from non-localhost. Host networking makes requests appear as localhost inside the container.

- **Docker Desktop:** Settings → Resources → Network → enable **“Enable host networking”**.
- **Docker Engine in WSL:** If you use `dockerd` directly, ensure host network mode is available and that Keycloak is reached as localhost (e.g. via `network_mode: host` in compose if you use it).

Restart Docker after changing settings.

## 5. Bootstrap the repo

From the repo root **in WSL** (do not run `make` from Git Bash, PowerShell, or CMD—Unix scripts in the repo will fail):

```bash
make
```

This installs dependencies, generates code, starts infra containers (Postgres, Keycloak, etc.), and builds libraries. It can take several minutes.

## 6. Wait for Keycloak

Open [http://localhost:8080](http://localhost:8080/) in your browser. Wait until you see the Keycloak sign-in page.

If 8080 isn’t reachable from Windows, use WSL’s IP or `localhost` from inside WSL (`curl http://localhost:8080`).

## 7. Migrations and seed

```bash
make migrate && make seed
```

## 8. Start the control plane (Terminal 1)

**Studio needs the control plane to be running** so it can call `/v1/auth/session` (port 3001). If you skip this or stop it, Studio will show connection errors and auth will fail.

```bash
make start-cp
```

Leave this running.

## 9. Start Studio (Terminal 2)

Open a second WSL terminal, `cd` to the repo root, then:

```bash
make start-studio
```

## 10. Log in to Studio

Open [http://localhost:3000](http://localhost:3000/) and sign in with:

- **Username:** `foo@wundergraph.com`
- **Password:** `wunder@123`

## 11. Verify

Confirm Studio loads and that UI updates when you change components under `studio/`.

---

## WSL tips

- **Store the repo on the WSL filesystem** (e.g. `~/cosmo` or `/home/<user>/cosmo`) for best performance with Node/pnpm/Docker.
- **Ports:** If `localhost` from Windows doesn’t reach a service, try `http://<wsl-ip>:3000` or use the same browser from inside WSL (e.g. WSLg).
- **Cleanup:** To tear down infra and volumes: `make infra-down-v`. Then you can run `make` again to bootstrap from scratch.

For full local dev (demos, subgraphs, router), see [CONTRIBUTING.md](./CONTRIBUTING.md#local-development).

### Seed hangs with no output

`make seed` connects to Keycloak first; if you see no output, it is usually waiting on Keycloak or the database.

1. **Confirm infra is up:** `docker compose -f docker-compose.yml --profile dev ps` — postgres and keycloak should be "Up".
2. **Confirm Keycloak is ready:** In a browser or from WSL run `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080` — you want `200` or `302`. If it fails or hangs, Keycloak is not ready or not reachable; wait a minute after `make` and try again.
3. **Confirm controlplane env:** In `controlplane/.env`, `KC_API_URL` should be `http://localhost:8080` and `DB_URL` should point at `localhost:5432` when running from WSL.
4. After the change in seed, you should see `Seed: connecting to Keycloak and database...` as soon as the script starts; if that appears and then it hangs, the hang is at Keycloak or Postgres.
