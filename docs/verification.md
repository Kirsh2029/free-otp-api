# Verification record

Executed on **2026-11-05** against the modernization of baseline `b6d64eeea264789bf904c9a63bf2c19ffb1c0ff3`. The original checkout was clean and matched `origin/master`; no prior proposed changes were present. The existing root-domain website was not changed.

## Build and automated tests

The backend and UI dependencies were installed from their npm lockfiles. Native checks used Node 26.8.1; the packaged runtime uses Node 24.22.2 and Puppeteer 25.16.0's matched Chrome 156.0.8078.47.

| Executed check | Result |
| --- | --- |
| `npm run build` | Passed, all backend TypeScript compiled |
| `npm run lint` | Passed |
| `TEST_REDIS_URL=redis://127.0.0.1:16379 npm test` | **55 passed, 0 failed, 0 skipped** |
| `npm --prefix ui test` | **8 passed, 0 failed, 0 skipped** |
| `npm --prefix ui run build` | Passed, TypeScript and Vite production bundle |
| Production dependency audits, backend and UI | Zero reported vulnerabilities at execution time |
| `git diff --check` | Passed |

Tests include configuration and URL validation, allowed/disallowed CORS and OPTIONS, Swagger server prefixes, route validation and response contracts, source selection and cached ownership, matching and time filters, single/empty message results, phone calling codes, OTP boundaries, provider registration, pagination and cancellation, browser launch failure/rotation/shutdown, real Redis cache expiry/corruption, unavailable Redis, silent handshakes, half-open established Redis connections, reconnect recovery, Redis-before-listen and process SIGTERM shutdown.

The React bundle emits Vite's advisory about a large client bundle; compilation succeeds. The browser regression with explicit HTTP fixtures verified all API list pages, source warnings, zero-count country visibility, empty-inbox refresh, and single-message rendering. A separate browser run against the real Docker API rendered **10 public SMS rows**, returned HTTP 200 and recorded no JavaScript errors or error alerts.

## Native API integration

The final source was run on `http://127.0.0.1:3130` using a persistent Redis on loopback port 16379 and standard headless Chrome. No fake provider data was used in these live checks.

| Endpoint / operation | Actual result |
| --- | --- |
| `/health`, `/health/live` | HTTP 200 |
| `/docs/`, `/docs/json` | HTTP 200; title Number API; server `https://number-api.inboxcloudkit.xyz/api` |
| `/api/countries` | HTTP 200; 104 country/source records |
| `/api/providers` | HTTP 200; all seven historical IDs |
| CORS OPTIONS from `https://inboxcloudkit.xyz` | HTTP 204; exact origin; no credentials header |
| AnonymSMS UK listing | HTTP 200; 8 numbers |
| AnonymSMS UK inbox pages 1 and 2 | HTTP 200; 5 messages per requested limit, OTPs parsed |
| ReceiveSMS USA complete listing | HTTP 200; 94 unique numbers, approximately 4.4 seconds |
| ReceiveSMS USA inbox pages 1 and 2 | HTTP 200; 5 messages per requested limit, OTPs parsed |
| ReceiveASMSOnline UK complete listing | HTTP 200; 171 numbers, approximately 0.6 seconds |
| ReceiveASMSOnline UK inbox | HTTP 200; 5 messages per requested limit, OTPs parsed |

One repeat listing reached its 60-second deadline while a CPU-intensive emulated Docker image build was running. The API returned an explicit provider failure; the subsequent run after the build load passed. This also exposed and fixed timeout status aggregation: all timed-out listing sources now retain HTTP 504. External stock and response times remain variable.

Provider investigation, individual handler results and restrictions are described in [providers.md](providers.md). No SMS was sent and no third-party account was accessed. Public SMS contents and OTP values are omitted from this record.

## Docker deployment

The final image was built and started with Compose, with all **41 compiled JavaScript files** compared by SHA256 against the frozen local build. The hashes matched. The final tested image begins `55eca476a325`.

- Compose configuration and image build passed; the matching Chrome binary launched and rendered a test page inside the container.
- Both services became healthy through `docker compose up -d --wait`.
- Redis PING returned PONG, append-only persistence was enabled, and a temporary test key survived a Redis restart before being deleted.
- Redis interruption produced readiness HTTP 503, followed by HTTP 200 after recovery.
- API SIGTERM exited with code 0. Stop/start and complete Compose restart both returned healthy services.
- Health, Swagger HTML/OpenAPI, countries (104 records) and provider registration (seven IDs) returned HTTP 200.
- Inspection confirmed that Redis has no published host port and the API is published only on host loopback port 3030.
- The final image also passed live listings for AnonymSMS UK (8), ReceiveSMS USA (94) and ReceiveASMSOnline UK (171), with successful real inbox retrieval and supported pagination. Each requested inbox page returned five messages under the requested limit, with OTP extraction verified without logging values.

## Public HTTPS deployment

A request initially returned Cloudflare HTTP 525. Existing authenticated Cloudflare CLI access was subsequently verified and used to create a **separate** locally managed tunnel named **number-api-inboxcloudkit** (`1e8d9753-707d-4b3e-a3cc-ac57770ab0d3`). Only a new CNAME for **number-api.inboxcloudkit.xyz** was added; no overwrite flag was required. The existing root website, root DNS records and unrelated tunnel were not modified.

The connector runs as a third Docker service using the pinned official Cloudflare image, a read-only filesystem, no capabilities, and read-only private credential/config mounts outside Git. Its ingress allows only the Number API hostname, forwarding to `http://api:3030`; the catchall returns 404. Redis remains private. Both the new connector and the existing unrelated tunnel had four active connections after deployment.

Actual HTTPS requests to **https://number-api.inboxcloudkit.xyz** passed:

- `/health`, `/health/live`, `/docs/`, `/docs/json`: HTTP 200, Redis up, correct Number API title and OpenAPI server.
- `/api/countries`: HTTP 200, 104 records; `/api/providers`: HTTP 200, seven providers.
- Complete listings: AnonymSMS UK 8, ReceiveSMS USA 94, ReceiveASMSOnline UK 171.
- Real inbox pages: AnonymSMS and ReceiveSMS pages 1/2, ReceiveASMSOnline page 1; HTTP 200, five messages per requested page limit, OTPs parsed.
- CORS preflight: HTTP 204, exact allowed origin and no credential header.

The GitHub Actions run for application/documentation commit `a2a4277955474b59f41784df3f79afb5a66fbaa7` also passed dependency installation, lint, backend/frontend builds and tests, Docker build, healthy Compose startup and HTTP checks: [CI run](https://github.com/Kirsh2029/free-otp-api/actions/runs/42076097570).

This public deployment is hosted on the user's Mac through the dedicated Colima Docker profile. The Mac, its network connection and Colima must remain running. No always-on remote server was provisioned. For continuous service, migrate the same Compose stack and dedicated tunnel credentials to an always-on host using [deployment.md](deployment.md).
