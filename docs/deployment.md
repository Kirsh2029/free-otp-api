# Number API deployment

The API runs on port **3030**. Its public base is `https://number-api.inboxcloudkit.xyz/api`, Swagger is `/docs`, and readiness is `/health`. This repository does not deploy or replace the existing `inboxcloudkit.xyz` website.

## Local installation

Use Node.js 24 (see `.nvmrc`), npm, and Redis 7 or newer. Node 24 is used in the Docker image. The Redis client is Redis 6.x; the server in Compose is Redis 8.10.3.

```sh
git clone https://github.com/Kirsh2029/free-otp-api.git
cd free-otp-api
cp .env.example .env
npm ci
# Run Redis separately; keep it bound to loopback for local development.
redis-server --bind 127.0.0.1 --appendonly yes
```

In another terminal, from the checkout:

```sh
npm run build
npm start
```

For changes during development, use `npm run dev`. If npm installation skips Puppeteer's browser download, run `npx puppeteer browsers install chrome`. On Linux, the package-matched browser also requires OS libraries; as an administrator use `npx puppeteer browsers install chrome --install-deps`, or use Docker. A managed browser may be selected with `PUPPETEER_EXECUTABLE_PATH`.

```sh
curl --fail http://localhost:3030/health
curl --fail http://localhost:3030/health/live
curl --fail http://localhost:3030/docs/json
curl --fail http://localhost:3030/api/countries
curl --fail http://localhost:3030/api/providers
```

The public URL in `.env` controls generated API links and OpenAPI. It does not bind DNS or install an HTTPS certificate. Local clients can still use `http://localhost:3030/api` while that public identity is configured.

## Docker Compose

Install Docker Engine or Docker Desktop with Compose v2.24 or later (`env_file.required` support), and an x86_64 Linux container runtime. Compose selects `linux/amd64` because the exact Chrome for Testing build pinned by Puppeteer is distributed for Linux x86_64. ARM machines require working x86 emulation; native x86_64 Linux is the preferred production target.

```sh
cp .env.example .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f
```

The API binds to **127.0.0.1:3030**, so a reverse proxy on the same host can reach it. Set `API_PORT=3130` for a different host port; the container port remains 3030. Redis has no published port. The named `redis-data` volume preserves its append-only database through container replacement.

```sh
docker compose stop
docker compose start
docker compose restart
docker compose down
```

`down` keeps the Redis volume. Do not add `--volumes` unless permanent cache deletion is intended. Shutdown sends SIGTERM, drains the API, stops jobs/browser activity, and closes Redis. Readiness includes Redis; liveness is separate. Redis must be healthy before Compose starts the API.

Compose sets `REDIS_URL=redis://redis:6379`, `HOST=0.0.0.0`, and `PORT=3030` inside the API, overriding corresponding local `.env` values. It sets `PUPPETEER_NO_SANDBOX=true` to run Chrome in the restricted container without privileged capabilities. The process runs as the unprivileged `node` user. Do not mount host secrets into this container. A production environment providing a compatible browser sandbox can override this setting explicitly.

The multi-stage Dockerfile pins Node 24.22.2 by digest, installs dependency versions from `package-lock.json`, compiles TypeScript, removes development packages, and uses Puppeteer's own installer to fetch the exact Chrome revision selected by the installed Puppeteer 25.16.0. It does not depend on the host's browser or node_modules.

## DNS, HTTPS, and reverse proxy

For a direct reverse-proxy deployment, create an **A** record for **number-api.inboxcloudkit.xyz** pointing to your API server; add an AAAA record only if that host has working IPv6. The optional Cloudflare Tunnel setup below uses its own subdomain route instead of these direct-origin records. Do not change the apex domain's A/AAAA records, its existing website, or its virtual-host configuration. Open inbound 443 (and 80 when using HTTP certificate challenges) on the API proxy. Keep 3030 and 6379 private.

For an existing Nginx installation, add a separate virtual-host file for the API subdomain. Start with this HTTP block to verify DNS and obtain a certificate:

```nginx
server {
    listen 80;
    server_name number-api.inboxcloudkit.xyz;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Validate and reload Nginx. Obtain a certificate only for this subdomain using your existing certificate workflow, then serve the same location under HTTPS and redirect HTTP to HTTPS. For Certbot with its Nginx plugin, the relevant command is `certbot --nginx -d number-api.inboxcloudkit.xyz`; review its changes to the API virtual host. No path rewriting is needed: `/api`, `/docs`, `/docs/json`, `/health`, and OPTIONS requests must reach Fastify unchanged. Do not add competing wildcard CORS headers at the proxy.

A separate Caddy virtual-host block is another option when Caddy already manages the server's HTTPS:

```caddyfile
number-api.inboxcloudkit.xyz {
    reverse_proxy 127.0.0.1:3030 {
        transport http {
            read_timeout 120s
        }
    }
}
```

Do not replace an existing Caddyfile; include only this additional subdomain block through the installation's existing configuration management.

After DNS and TLS are configured:

```sh
curl --fail https://number-api.inboxcloudkit.xyz/health
curl --fail https://number-api.inboxcloudkit.xyz/docs/json
curl --fail https://number-api.inboxcloudkit.xyz/api/countries
curl --fail https://number-api.inboxcloudkit.xyz/api/providers
curl -i -X OPTIONS https://number-api.inboxcloudkit.xyz/api/countries \
  -H 'Origin: https://inboxcloudkit.xyz' \
  -H 'Access-Control-Request-Method: GET'
```

Open `https://number-api.inboxcloudkit.xyz/docs` for Swagger. Production DNS, proxy, and TLS are infrastructure steps separate from source-code configuration; successful local tests do not establish that production is deployed.

## Optional dedicated Cloudflare Tunnel

The current deployment uses the dedicated `number-api-inboxcloudkit` tunnel, UUID `1e8d9753-707d-4b3e-a3cc-ac57770ab0d3`, and only the `number-api.inboxcloudkit.xyz` DNS route. Public HTTPS health, Swagger, country/provider listings, and all three verified providers' public inboxes passed deployment checks on 2026-11-05. The existing root website and its separate tunnel remain in place.

This deployment currently runs on the local Mac's dedicated Colima Docker profile. The Mac must remain powered on and awake, with Colima/Docker and this connector running, for the public API to remain available. `restart: unless-stopped` restarts containers while Docker is running; it does not install a macOS login service or prevent sleep. For continuous production uptime, move this same Compose stack and dedicated tunnel files to an always-on server. No global startup services are installed by these instructions.

[Cloudflare's locally managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/) describes the account setup. This project provides a separate Docker connector in `docker-compose.tunnel.yml`. Its config allows only `number-api.inboxcloudkit.xyz` and returns 404 for every other hostname. It reaches the API at `http://api:3030` on the Compose network; Redis has no tunnel route. This option needs outbound connectivity to Cloudflare rather than inbound ports 80/443 on the Docker host.

Keep this connector separate from any existing tunnel serving the root website or other projects. Do not edit the account's global `cloudflared` configuration, reuse another project's tunnel, or mount its account-wide `cert.pem` into the container. The dedicated tunnel credential is sufficient to run this connector.

For a new deployment that has no Number API tunnel yet, authenticate `cloudflared` using your existing Cloudflare workflow, then create the dedicated tunnel once. Keep credentials outside the checkout:

```sh
install -d -m 700 ../number-api-tunnel
cloudflared tunnel create --credentials-file "$PWD/../number-api-tunnel/credentials.json" number-api-inboxcloudkit
cp deploy/cloudflared.yml.example ../number-api-tunnel/config.yml
chmod 600 ../number-api-tunnel/credentials.json ../number-api-tunnel/config.yml
```

Replace `TUNNEL_UUID` in that private `config.yml` with the UUID printed by `create`. For an existing Number API tunnel, reuse its dedicated UUID and credential file instead of creating another tunnel. The config's `credentials-file` must remain `/etc/cloudflared/credentials.json`, its **container** path. It should contain exactly:

```yaml
tunnel: TUNNEL_UUID
credentials-file: /etc/cloudflared/credentials.json
ingress:
  - hostname: number-api.inboxcloudkit.xyz
    service: http://api:3030
  - service: http_status:404
```

On the current Mac installation, select the existing dedicated Colima engine and workspace Docker CLI configuration before the commands below:

```sh
colima status --profile number-api
export DOCKER_HOST="unix://$HOME/.colima/number-api/docker.sock"
export DOCKER_CONFIG="$PWD/../docker-cli"
```

These two exports are specific to this existing Mac workspace. A standard Docker Desktop or Linux Docker installation uses its normal Docker context instead. Start the existing `number-api` Colima profile if it is stopped; do not replace another profile or change the root website's connector.

The overlay requires explicit absolute file paths. Its default user is 65532:65532; to preserve mode 600 files owned by your current host user, run it with that user's numeric UID/GID as shown here. The host directory remains 700. The files are mounted individually read-only; the process has a read-only root filesystem, no Linux capabilities, and no published ports.

```sh
export NUMBER_API_TUNNEL_CREDENTIALS_FILE="$PWD/../number-api-tunnel/credentials.json"
export NUMBER_API_TUNNEL_CONFIG_FILE="$PWD/../number-api-tunnel/config.yml"
export NUMBER_API_TUNNEL_UID="$(id -u)"
export NUMBER_API_TUNNEL_GID="$(id -g)"

docker compose -f docker-compose.yml -f docker-compose.tunnel.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --wait
```

| Variable | Requirement | Meaning |
| --- | --- | --- |
| `NUMBER_API_TUNNEL_CREDENTIALS_FILE` | Required with overlay | Absolute path to this tunnel's private JSON credential file. |
| `NUMBER_API_TUNNEL_CONFIG_FILE` | Required with overlay | Absolute path to its private YAML ingress configuration. |
| `NUMBER_API_TUNNEL_UID` | Optional, default 65532 | Numeric user that can read both mounted files; use `id -u` for owner-only host files. |
| `NUMBER_API_TUNNEL_GID` | Optional, default 65532 | Numeric group; use `id -g` with the matching user. |

Only after the connector is healthy, create the DNS route for the **API subdomain** using its UUID:

```sh
cloudflared tunnel route dns TUNNEL_UUID number-api.inboxcloudkit.xyz
curl --fail https://number-api.inboxcloudkit.xyz/health
curl --fail https://number-api.inboxcloudkit.xyz/docs/json
```

If that subdomain already has a DNS record, reconcile only that exact record with the dedicated tunnel route. Keep the apex, `www`, and every unrelated DNS record unchanged. Cloudflare serves HTTPS for this hostname; this overlay does not change the root website's proxy, certificate, DNS route, or existing connector.

Use both Compose files when managing this deployment:

```sh
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs -f cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml restart cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop cloudflared
```

The health check calls the connector's private readiness endpoint and its restart policy is `unless-stopped`. The image is official `cloudflare/cloudflared:2026.10.7`, pinned by its multi-architecture manifest digest. For a move to another server, copy only this tunnel's private files through your normal secret-management process, keep their restrictive permissions, and start the same overlay there. Production availability still depends on that host, Docker, and the outbound connector remaining running.

## Frontend

The optional React UI is built independently; follow [ui/README.md](../ui/README.md). Its production API value is set with `VITE_API_BASE_URL`. No frontend artifact is uploaded to the root website by the deployment commands above.

## Controlled fresh SMS checks

A successful listing or readable inbox history establishes those individual capabilities. It does not establish that a number receives a newly sent SMS. The frontend's **Test SMS delivery** card calls `POST /api/delivery-tests` to capture a baseline and generate a unique dummy message. Number API does not send that message. A user copies it to an external sender they control; the browser performs bounded, non-overlapping `GET /api/delivery-tests/:id` checks until receipt, expiry, error, or manual stop.

Backend status `received` means the unique marker and expected code text were newly observed after the baseline. Provider timestamps may be approximate. OTP extraction is a separate result: `evidence.otpMatched=true` verifies extraction for that check, while false is displayed as an extraction failure. Expired and failed checks leave delivery unverified. The UI keeps those results separate from readable historical messages and an empty result after filtering.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DELIVERY_TEST_TTL_SECONDS` | 600 | Maximum pending check lifetime. |
| `DELIVERY_TEST_RETENTION_SECONDS` | 86400 | Redis retention for check records. |
| `DELIVERY_TEST_MAX_PER_MINUTE` | 20 | Global creation limit for this public testing workflow. |

The workflow uses mandatory Redis storage; it does not add an outbound SMS service or modify any tunnel or website. Local fixture tests demonstrate the request, parsing, matching, and persistence flow; a fixture is not carrier-delivery evidence.

## Troubleshooting

- API exits before listening: verify Redis is reachable and check `docker compose logs api redis`. There is no in-memory fallback.
- Readiness 503 with liveness 200: Redis lost connectivity; restore Redis and inspect bounded reconnect logs.
- Browser not found locally: run `npx puppeteer browsers install chrome`; do not point at a nonexistent executable.
- Browser fails in Docker: confirm an x86_64 runtime or working emulation, sufficient shared memory, and the Compose sandbox setting. Never use privileged mode to solve a provider access challenge.
- Upstream 502/503: inspect `/api/providers` and provider status documentation. A blocked or failed source is not an empty inbox; upstream availability and terms can change.
- Frontend CORS errors: allow its exact origin using `CORS_ORIGINS`, rebuild the UI after changing its build-time API URL, and ensure the reverse proxy forwards OPTIONS.
- Old cached results: cache expiration is controlled by `CACHE_TTL_SECONDS`; scheduled refresh retains valid cached data on an upstream failure. Use a separate Redis database for tests rather than deleting production data.
