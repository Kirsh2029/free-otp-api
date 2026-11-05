# Number API

Redis-backed API for discovering shared public SMS numbers and reading their public inboxes for authorized testing. It modernizes the original [Shelex/free-otp-api](https://github.com/Shelex/free-otp-api) project while preserving its country, number-list and message response shapes.

- API: **https://number-api.inboxcloudkit.xyz/api**
- Swagger: **https://number-api.inboxcloudkit.xyz/docs**
- Readiness: **https://number-api.inboxcloudkit.xyz/health**

The initial deployment was verified on 2026-11-05 through a dedicated Cloudflare Tunnel to this Mac's Docker stack; [verification.md](docs/verification.md) separates that earlier deployment from this rebuild's checks. The host and Colima must remain running; use an always-on Docker host for continuous availability. Cloning the project does not automatically provision Cloudflare or start a public deployment. The existing **inboxcloudkit.xyz** website remains a separate project; only the API subdomain was routed here.

The current provider audit verifies public listings and reads of existing messages for three source IDs. **Fresh SMS delivery remains unverified for all seven providers.** A listed number, a readable historical inbox, or a parsed old OTP does not establish that a newly sent SMS reaches that number. The [controlled delivery check](#controlled-fresh-sms-check) records that distinction for an individual number and test message. No new SMS was sent or received during the rebuild audit.

## Architecture

Node.js 24+ and TypeScript run a Fastify 5 API. Standard Puppeteer and puppeteer-cluster parse public provider pages in isolated browser contexts, with bounded navigation, task queues, pagination and retries. No stealth or challenge-solving plugins are installed. Redis is required: startup connects and pings Redis before opening the API socket. Cached number lists expire after 12 hours by default, and provider-specific cron jobs refresh them approximately every eight hours. Failed refreshes retain the previous cache.

The optional React frontend is built independently with Vite. The API does not serve or replace the root website. Docker runs the API and a private persistent Redis service; a reverse proxy handles HTTPS.

## Quick start with Docker

Install Docker Engine/Desktop with Compose v2.24+ and Git, then:

~~~sh
git clone https://github.com/Kirsh2029/free-otp-api.git
cd free-otp-api
cp .env.example .env
docker compose up -d --build
docker compose logs -f
~~~

The API binds to 127.0.0.1:3030 on the Docker host. Redis has no published host port. Compose waits for Redis health before starting the API; both services restart automatically. The Redis named volume keeps data across container recreation.

~~~sh
curl --fail http://127.0.0.1:3030/health
curl --fail --location http://127.0.0.1:3030/docs
curl --fail http://127.0.0.1:3030/docs/json
docker compose ps
docker compose restart
docker compose stop
docker compose up -d
# Remove containers while retaining cached data:
docker compose down
~~~

Chrome for Testing is packaged for Linux x86_64. Compose selects linux/amd64 so the package-matched browser also works on ARM Docker hosts through emulation. A compatible Docker runtime with amd64 support is required. See [deployment details](docs/deployment.md) for browser installation, platform constraints and reverse-proxy setup. Do not mount a host node_modules directory into this container.

## Local installation

Prerequisites: Node.js 24 or newer, npm, Redis, and the browser libraries required by Puppeteer. npm ci installs the browser version matched to the pinned Puppeteer package. On Linux, the Puppeteer installer can install system dependencies:

~~~sh
git clone https://github.com/Kirsh2029/free-otp-api.git
cd free-otp-api
npm ci
cp .env.example .env
# Linux only, if browser system libraries are missing (requires package-install privileges):
npx puppeteer browsers install chrome --install-deps
~~~

Start a loopback-only Redis instance with persistence (or use an existing reachable Redis):

~~~sh
mkdir -p /tmp/number-api-redis
redis-server --bind 127.0.0.1 --port 6379 --appendonly yes --dir /tmp/number-api-redis
~~~

In another terminal:

~~~sh
npm run build
npm start
# For development, instead:
npm run dev
~~~

For Redis on a different host or port, set REDIS_URL in .env. A redis:// or rediss:// URL takes precedence over separate host, port and password settings. For a production Redis instance use a durable data directory and your platform's service manager. Do not publish its port to the internet.

## API endpoints

| Method | Path | Response |
| --- | --- | --- |
| GET | / | Identity, configured API base, docs and health paths |
| GET | /health | 200 when Redis is ready; 503 when degraded |
| GET | /health/live | Process liveness |
| GET | /docs | Swagger UI |
| GET | /docs/json | OpenAPI document |
| GET | /api/providers | Historical source IDs, active/unavailable countries, and separate listing, inbox-read and fresh-delivery verification |
| GET | /api/countries | Legacy array of country/source/URL/current cached count |
| GET | /api/list/:country | phones array, optional upstream errors and pagination |
| GET | /api/:country/:phoneNumber | requested, result (or null), results, pagination and actual read diagnostics when available |
| POST | /api/delivery-tests | Read a baseline and prepare a unique dummy SMS for a manual delivery check; sends no SMS |
| GET | /api/delivery-tests/:id | Check a prepared test: pending, received or expired, with read/evidence metadata |

The configured API_BASE_URL pathname determines the API prefix. The defaults above use /api. Health and docs remain at the host root.

~~~sh
curl --fail 'https://number-api.inboxcloudkit.xyz/api/countries'
curl --fail 'https://number-api.inboxcloudkit.xyz/api/providers'
curl --fail 'https://number-api.inboxcloudkit.xyz/api/list/UK?source=anonymsms.com&page=1&limit=100'
~~~

Use a number actually returned by the listing, keeping its source:

~~~sh
PHONE=NUMBER_RETURNED_BY_LIST
curl --fail --get "https://number-api.inboxcloudkit.xyz/api/UK/$PHONE" \
  --data-urlencode 'source=anonymsms.com' \
  --data-urlencode 'since=0' \
  --data-urlencode 'match=verification' \
  --data-urlencode 'limit=20'
~~~

- Country names retain the historical enum identifiers, such as USA, UK, Germany and SouthKorea. /countries reports enabled providers' supported countries.
- Phone numbers return as E.164 digits **including the calling code**, without a leading plus. Requests also accept an encoded leading plus or correctly formatted national numbers for the selected country. Invalid numbers return 400.
- source filters /countries, /list and message requests. Always carry the listing's source into message requests. Without source, message lookup first uses a matching cached provider, then prefers an eligible source with verified historical inbox-read compatibility. This preference is not a delivery guarantee.
- list page starts at 1; limit is 1–1000 (default 1000). These paginate the combined cached/live results. Upstream listing pagination is collected under MAX_PROVIDER_PAGES and an overall browser task deadline.
- Inbox page starts at 1 and follows provider pagination where supported. An unsupported inbox page returns an explicit error. limit bounds matching messages.
- match is a case-sensitive substring, decoded once by Fastify. URL-encode query values.
- ago defaults to 30s; supported suffixes are s, m, h, d and w. since is Unix milliseconds, overrides ago, and accepts 0 to inspect older public messages. requested.timeFilter names the effective filter; requested.agoText is omitted when since is supplied. Repeated parameters and blank numeric filters return 400.
- timeout defaults to 0 (one inbox read); set milliseconds up to 20000 for bounded polling. This retains polling without infinite recursion.
- result is the first match or null; results contains every returned match, including a single match. OTP extraction finds complete 4–8 digit sequences rather than fragments of longer numbers.
- diagnostics are emitted only after an actual provider read: raw rows, parsed messages, timestamp/content drops, time/matcher exclusions, matched/returned counts, page, polling count and oldest/newest observed timestamps. diagnostics.deliveryStatus remains unverified: reading history does not verify a fresh send. An unreadable or entirely unparseable inbox returns an error rather than a successful empty result.
- All /api responses use Cache-Control: no-store; Redis remains the number-list cache.
- /countries counts describe the Redis cache, not a live inventory claim. An initially empty cache has zero counts; /list performs the live lookup. The X-Number-Counts response header marks this distinction.
- Invalid requests return 400. Removed inboxes may return 404; unsupported, blocked or unavailable sources return 503; upstream failures return 502; deadlines return 504. Partial source failure returns successful phone results plus an errors array. Provider failures are never disguised as successful empty lists.

## Controlled fresh SMS check

Use a number from a current listing and retain its exact source. The API performs a real baseline read before returning a test ID and new dummy message. It sends no SMS, accesses no sender account, and performs no unattended background sending. The following example requires `curl` and `jq`:

~~~sh
NUMBER_API_BASE=https://number-api.inboxcloudkit.xyz/api
NUMBER_API_PHONE=$(curl --fail --silent --show-error "$NUMBER_API_BASE/list/USA?source=receivesms.co&limit=1" | jq -er '.phones[0].value')
NUMBER_API_BODY=$(jq -cn --arg phone "$NUMBER_API_PHONE" '{country:"USA",phoneNumber:$phone,source:"receivesms.co"}')
NUMBER_API_PROBE=$(curl --fail-with-body --silent --show-error "$NUMBER_API_BASE/delivery-tests" \
  -H 'Content-Type: application/json' --data "$NUMBER_API_BODY")
printf '%s\n' "$NUMBER_API_PROBE" | jq '{id,status,phoneNumber,source,messageText,expectedOtp,expiresAt}'
NUMBER_API_TEST_ID=$(printf '%s\n' "$NUMBER_API_PROBE" | jq -er '.id')
~~~

Send exactly the returned `messageText` to the returned phone number, including its country calling code, using an external SMS sender you control. Use only the generated dummy text. Then check the same test ID, allowing at least three seconds between checks:

~~~sh
curl --fail-with-body --silent --show-error "$NUMBER_API_BASE/delivery-tests/$NUMBER_API_TEST_ID" | jq
~~~

The frontend's **Test SMS delivery** card exposes this same flow and checks approximately every five seconds while active. HTTP requests drive the checks; creating a record does not start a server-side polling job.

| Status / field | Meaning |
| --- | --- |
| pending | No matching new marker plus expected code has been observed; delivery remains unverified |
| received | This exact marker and expected code text, absent from the baseline, appeared in a provider message within the test's timestamp window; this proves observation of this specific test only |
| evidence.otpMatched | Whether the OTP extractor also returned the expected code; may be false even when the matching code text was observed |
| expired | The test window ended without a verified observation; this does not diagnose the sender or carrier |
| baselineRead / currentRead | Actual provider parsing/filter diagnostics when available; include read time and newest observed message time |
| checkDeferred / nextCheckAt | A recent or concurrent check already covers this test; wait before checking again |
| lastError | The provider check failed; an error is not an empty inbox or proof of delivery |

The default test window is ten minutes. Records remain in Redis for 24 hours from creation, including completed or expired records; updates do not extend that retention. Expiry is evaluated when the record is checked. After retention ends, GET returns 404. Creation attempts share a global limit of 20 per minute, including attempts whose baseline read fails; excess attempts return 429. Per-test checks have a three-second cooldown and a Redis lease preventing overlapping browser work. Upstream errors remain 502/503/504 with delivery unverified.

Provider-level `verification.freshSmsDelivery` is separate from these per-test records. This release records it as unverified for every provider. A historical read and a pending test do not promote it to verified. See [the verification record](docs/verification.md) for the evidence actually collected.

## Backend environment

All backend application settings are parsed in src/config.ts. Copy .env.example; .env is ignored by Git and excluded from the Docker image. URL settings are validated and trailing slashes normalized. Secrets belong only in backend configuration.

| Variable | Default/example | Purpose |
| --- | --- | --- |
| API_BASE_URL | https://number-api.inboxcloudkit.xyz/api | Public API base and Swagger server; default works for this deployment |
| PUBLIC_URL | https://number-api.inboxcloudkit.xyz | Legacy fallback used only when API_BASE_URL is absent; root URLs acquire /api |
| NODE_ENV | development; Compose sets production | Runtime environment |
| HOST | 0.0.0.0 | Listen address; use 127.0.0.1 for a local-only native process |
| PORT | 3030 | API listen port |
| CORS_ORIGINS | https://dashboard.example.com | Optional comma-separated additional exact origins |
| REDIS_URL | redis://127.0.0.1:6379 | Optional Redis/TLS URL; overrides REDIS_HOST/PORT/PASSWORD |
| REDIS_HOST | 127.0.0.1 | Redis host when URL is absent |
| REDIS_PORT | 6379 | Redis port when URL is absent |
| REDIS_PASSWORD | unset | Redis password when URL is absent |
| REDIS_CONNECT_TIMEOUT_MS | 10000 | Overall connection/handshake deadline |
| REDIS_COMMAND_TIMEOUT_MS | 5000 | Command deadline, including half-open network failures |
| REDIS_RECONNECT_ATTEMPTS | 3 | Bounded reconnect attempts; 0 disables retries |
| CACHE_TTL_SECONDS | 43200 | Number-list expiry |
| BROWSER_MAX_CONCURRENCY | 3 | Concurrent isolated browser contexts |
| BROWSER_TASK_TIMEOUT_MS | 60000 | Browser queue/task and whole-listing deadline |
| BROWSER_NAVIGATION_TIMEOUT_MS | 30000 | Individual navigation/selector deadline |
| BROWSER_REFRESH_INTERVAL_MS | 600000 | Drain and recreate the browser periodically |
| PUPPETEER_EXECUTABLE_PATH | unset | Optional managed browser binary; package-matched browser is preferred |
| PUPPETEER_NO_SANDBOX | false; Compose sets true | Explicit container browser compatibility setting |
| MAX_PROVIDER_PAGES | 50 | Maximum public listing pages; exceeded limits return an error |
| PROVIDER_RETRIES | 2 | Additional attempts for transient failures; restricted/unavailable pages are not retried |
| PROXY | http://proxy.example.com:8080 | Optional ordinary egress proxy without credentials/query/fragment |
| DELIVERY_TEST_TTL_SECONDS | 600 | Manual test observation window; 60–1800 seconds |
| DELIVERY_TEST_RETENTION_SECONDS | 86400 | Redis record retention from creation; 3600–604800 seconds |
| DELIVERY_TEST_MAX_PER_MINUTE | 20 | Global creation attempts per minute; 1–100 |
| API_PORT | 3030 | Compose host port only; internal API port remains 3030 |
| NUMBER_API_TUNNEL_CREDENTIALS_FILE | /absolute/private/number-api/credentials.json | Optional tunnel overlay: private, dedicated tunnel credential file |
| NUMBER_API_TUNNEL_CONFIG_FILE | /absolute/private/number-api/config.yml | Optional tunnel overlay: single-host ingress config |
| NUMBER_API_TUNNEL_UID | 65532 | Optional tunnel process UID; set to the private files' owner, e.g. with id -u |
| NUMBER_API_TUNNEL_GID | 65532 | Optional tunnel process GID; set to the private files' group, e.g. with id -g |

Default CORS origins are https://inboxcloudkit.xyz, https://www.inboxcloudkit.xyz, and HTTP localhost/127.0.0.1 on ports 3000 and 5173. Additional origins are additive. Preflight OPTIONS supports GET and the delivery-test POST; credentials are omitted, and wildcard origins are rejected. CORS governs browser access; it is not API authentication.

Puppeteer's installer also recognizes PUPPETEER_CACHE_DIR and PUPPETEER_SKIP_DOWNLOAD. They are build/install controls rather than application settings; Docker sets its own browser cache directory. Set TEST_REDIS_URL when running the real-Redis tests.

## Frontend configuration

The frontend has its own .env.example and build-time settings. It does not load the backend .env. See [the frontend guide](ui/README.md).

~~~sh
cd ui
npm ci
cp .env.example .env
# Edit VITE_API_BASE_URL to http://localhost:3030/api for a local API.
npm run dev
npm test
npm run build
~~~

VITE_API_BASE_URL defaults to https://number-api.inboxcloudkit.xyz/api. Backward-compatible REACT_APP_API_BASE_URL, REACT_APP_API_HOST and REACT_APP_API_PROTOCOL are accepted when the modern setting is absent. Rebuild after changing these values. Serve ui/dist on a separate preview host or an explicitly selected existing frontend deployment; this project does not install it on inboxcloudkit.xyz.

## Provider status

The full [provider investigation](docs/providers.md) records dated country/inbox URLs, DOM changes, pagination and access-policy evidence. Verification applies to the tested countries and sampled public inboxes, not every provider country or number.

| Stable source ID | Public listing / existing-message read | Fresh SMS delivery |
| --- | --- | --- |
| anonymsms.com | UK reads verified; now asms.ai. USA excluded after all eight advertised inbox links redirected to the country page | Unverified |
| receivesms.co | USA and UK listings and historical reads verified; supported pagination tested | Unverified |
| receivesmsonline.com | USA and UK listings and historical reads verified on receiveasmsonline.com; UK sample was an approximately eight-day-old archive | Unverified |
| receive-sms-free.cc | Enabled, browser access blocked by HTTP 403 | Unverified |
| smstome.com | Enabled, browser access blocked by HTTP 403; Sweden's dead endpoint excluded | Unverified |
| receive-smss-online.com | Enabled, no public inventory available for an inbox test | Unverified |
| quackr.io | Disabled: terms prohibit scraping | Unverified |

Restrictions are returned honestly. Authentication, CAPTCHAs and access checks are not bypassed. Inspect /api/providers for separate verification.listing, verification.inboxRead and verification.freshSmsDelivery checks, each with its evidence and country scope. unavailableCountries retains reasons for excluded country integrations. The legacy status and verifiedAt fields describe historical compatibility, not fresh delivery or continuous uptime.

## Testing

~~~sh
npm ci
npm run build
npm run lint
# Provide a separate test Redis. Tests use unique keys and remove their test data.
TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
npm --prefix ui ci
npm --prefix ui test
npm --prefix ui run build
docker compose config --quiet
docker compose up -d --build
curl --fail http://127.0.0.1:3030/health
~~~

Without TEST_REDIS_URL, the live cache/expiry and network-proxy Redis checks are explicitly skipped; all deterministic tests still run. Tests cover configuration, CORS, Swagger, route validation/contracts, phone parsing, OTP extraction, provider registration, pagination, network deadlines and browser lifecycle. Live public-provider checks are separate because upstream inventory and access restrictions change. Use a current returned number rather than inventing a test inbox.

The dated [verification record](docs/verification.md) distinguishes automated checks, actual public-provider integration, Docker lifecycle checks and the public HTTPS deployment.

## Domain, HTTPS and deployment

For an Nginx deployment on a separate server, point the **number-api.inboxcloudkit.xyz** DNS record at that server. Add AAAA only when the server accepts IPv6. Keep existing root/www records and website configuration unchanged. Open public ports 80/443; proxy only this hostname to the loopback API on port 3030, preserving /api and /docs paths. Obtain a certificate for this subdomain and forward Host and X-Forwarded-* headers. See the exact isolated Nginx configuration and certificate commands in [docs/deployment.md](docs/deployment.md).

The verified deployment uses the separate **number-api-inboxcloudkit** Cloudflare Tunnel and the optional docker-compose.tunnel.yml overlay instead of a public origin port. Its ingress accepts only number-api.inboxcloudkit.xyz and sends it to api:3030; unmatched hostnames receive 404. Cloudflare handles public HTTPS, and the connector opens an outbound encrypted connection. The root domain and its existing unrelated tunnel were left intact. Credentials stay outside the repository. The deployment guide includes exact overlay startup, log, shutdown and migration commands.

Production verification:

~~~sh
curl --fail https://number-api.inboxcloudkit.xyz/health
curl --fail --location https://number-api.inboxcloudkit.xyz/docs
curl --fail https://number-api.inboxcloudkit.xyz/docs/json
curl --fail https://number-api.inboxcloudkit.xyz/api/countries
~~~

## Troubleshooting and privacy

- Startup exits before listening: check Redis availability, credentials, URL scheme and connect deadline. There is no in-memory Redis replacement.
- /health returns 503: Redis is down or responding too slowly. /health/live distinguishes process liveness from dependency readiness.
- A new SMS is absent: first inspect diagnostics, use the exact listed source, and distinguish observed rows from matched rows. since=0 removes the time cutoff; an approximately eight-day-old archive should not match a recent-message filter. If the marker is absent from the provider's actual inbox, API history reads do not establish delivery. Use the controlled check to record a new marker and its evidence.
- A delivery check returns 429: wait for the next minute; creation is globally rate limited. checkDeferred means wait until nextCheckAt. An expired or failed test remains unverified.
- Country counts are zero: cache may be cold; call the relevant /list route. Failed sources produce explicit errors.
- Provider returns 403, an interactive-check page, 502 or 503: see provider status and logs; retry later or select another available listed source. Do not solve or circumvent access checks.
- Browser executable/libraries missing: reinstall the package-matched browser and dependencies; rebuild Docker after dependency updates.
- ARM Docker host: enable amd64 emulation. A generic ARM Chromium substitution has not been verified for this image.
- Pagination exceeds its limit or deadline: increase the documented bound deliberately, inspect provider inventory and monitor resource usage. Failed partial scans do not replace a complete cached list.
- CORS error: include the frontend's exact origin in CORS_ORIGINS and restart the API. Backend and frontend base URLs are configured independently.
- HTTPS path errors: proxy the original request path; stripping /api or adding it twice breaks routes.
- Public deployment: put resource/rate limits at the reverse proxy appropriate to your traffic. This API starts browser work and is not an authenticated private messaging system.

Public SMS numbers and messages are shared, visible to other people, and controlled by third parties. Use the service only for authorized tests. Never rely on it for sensitive accounts, confidential messages, account recovery or durable ownership of a number. No guarantee is made that an inbox remains available or that third-party timestamps and inventory remain correct. Inspect provider terms before deploying automated access.
