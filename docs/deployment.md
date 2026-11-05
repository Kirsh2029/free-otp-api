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

Create an **A** record for **number-api.inboxcloudkit.xyz** pointing to your API server; add an AAAA record only if that host has working IPv6. Do not change the apex domain's A/AAAA records, its existing website, or its virtual-host configuration. Open inbound 443 (and 80 when using HTTP certificate challenges) on the API proxy. Keep 3030 and 6379 private.

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

## Frontend

The optional React UI is built independently; follow [ui/README.md](../ui/README.md). Its production API value is set with `VITE_API_BASE_URL`. No frontend artifact is uploaded to the root website by the deployment commands above.

## Troubleshooting

- API exits before listening: verify Redis is reachable and check `docker compose logs api redis`. There is no in-memory fallback.
- Readiness 503 with liveness 200: Redis lost connectivity; restore Redis and inspect bounded reconnect logs.
- Browser not found locally: run `npx puppeteer browsers install chrome`; do not point at a nonexistent executable.
- Browser fails in Docker: confirm an x86_64 runtime or working emulation, sufficient shared memory, and the Compose sandbox setting. Never use privileged mode to solve a provider access challenge.
- Upstream 502/503: inspect `/api/providers` and provider status documentation. A blocked or failed source is not an empty inbox; upstream availability and terms can change.
- Frontend CORS errors: allow its exact origin using `CORS_ORIGINS`, rebuild the UI after changing its build-time API URL, and ensure the reverse proxy forwards OPTIONS.
- Old cached results: cache expiration is controlled by `CACHE_TTL_SECONDS`; scheduled refresh retains valid cached data on an upstream failure. Use a separate Redis database for tests rather than deleting production data.
