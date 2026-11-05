# Verification record

Rebuild checks on **November 5, 2026** distinguish application behavior, public inbox readability and fresh SMS delivery. The project originally started from clean `master` at `b6d64eeea264789bf904c9a63bf2c19ffb1c0ff3`; its initial dedicated public deployment was recorded at `9b9e58a`. Rebuild application changes include `0ad2461`, `e0e0899` and `63a3ec6`.

**No fresh sender-to-provider-to-API delivery has been verified.** The rebuild performed no outbound SMS sends. Reading an existing inbox or extracting an old OTP is not a fresh delivery test, and every provider's `verification.freshSmsDelivery.status` remains `unverified`.

## Rebuild automated checks

These checks actually ran against the rebuilt application; synthetic provider responses used by regression tests are not represented as real SMS reception.

| Executed check | Recorded result |
| --- | --- |
| Backend TypeScript build | Passed |
| Backend lint | Passed |
| Full backend suite with a real test Redis | **99 passed, 0 failed, 0 skipped** |
| Frontend unit tests | **13 passed, 0 failed, 0 skipped** |
| Frontend TypeScript/Vite production build | Passed |
| Frontend browser regression with explicit HTTP fixtures | Passed |
| Backend dependency audit, including development dependencies | Zero vulnerabilities reported at execution time |
| Frontend dependency audit, including development dependencies | Zero vulnerabilities reported at execution time |
| Full dependency audits, including development packages, for backend and frontend | Zero vulnerabilities reported at execution time |

Coverage includes configuration, CORS GET/POST preflight, schema validation, duplicate/blank query values, source/country selection, phone normalization, message time/text filters, diagnostic provenance, timeout status propagation, hydration readiness, provider timestamp formats, bounded listing work, browser lifecycle and real Redis lifecycle/deadlines. Delivery tests cover baseline reads, unique markers, code-text matching, pending/received/expired transitions, independent OTP extraction evidence, creation limits, concurrent checks, record retention and corrupt-record rejection. Their simulated receipt cases validate the implementation, not carrier delivery.

The earlier release's 55-backend/8-frontend totals and its image digest describe that release only; they are not the rebuilt application's verification totals.

## Public-provider repeat audit

Actual standard headless-browser checks ran approximately **3:20–3:30 p.m. America/New_York (20:20–20:30 UTC)**. Complete listing counts were collected around 3:29–3:30 p.m.; raw diagnostics came from the tested public inboxes, with no fabricated messages.

| Source / country | Listing result | Existing-message result | Fresh delivery |
| --- | --- | --- | --- |
| AnonymSMS / UK | Complete collection: 8 | 10 parsed, 0 drops | Unverified |
| AnonymSMS / USA | 8 advertised; all eight inbox links redirected to the country page | No readable advertised inbox; USA excluded for this source | Unverified |
| ReceiveSMS / USA | Complete collection: 93 | 40 parsed, 0 drops | Unverified |
| ReceiveSMS / UK | Complete collection: 10 | 40 parsed, 0 drops | Unverified |
| ReceiveASMSOnline / USA | Complete collection: 181 | 14 parsed, 0 drops | Unverified |
| ReceiveASMSOnline / UK | Complete collection: 171 | 47 parsed, 0 drops after the format/readiness correction; approximately eight-day-old archive | Unverified |
| Receive-SMS-Free / USA and UK | Browser HTTP 403; API availability error 503 | Not read in this repeat audit | Unverified |
| SMSTome / Slovenia | Browser HTTP 403; API availability error 503 | Not read in this repeat audit | Unverified |
| Receive-SMSS-Online / USA and UK | No public inventory; explicit 503 | No listed inbox available | Unverified |
| Quackr | Disabled after its terms prohibited scraping | Not scraped | Unverified |

The machine-readable repeat audit is retained in the execution workspace at `work/provider-audit/rebuild-live-results.json`. See [providers.md](providers.md) for public URLs, selectors, pagination, policy references and country scope. Inventory counts are observations at that time, not constants promised by the API.

## Missing-message findings and fixes

Before the rebuild, a read investigation at approximately **2:47–2:49 p.m. America/New_York (19:47–19:49 UTC)** compared a supplied dummy marker with the actual ReceiveASMSOnline USA inbox and the native, Docker and public APIs. The provider contained 14 message rows; all 14 were extracted and timestamp-parsed, with zero timestamp drops. Each unfiltered API read returned 14 messages. The supplied marker was absent from the provider and every tested API response, including a case-insensitive direct check. No sender receipt was established.

Those observations establish that the available history was preserved for that sample. They do not show that the sender's new SMS reached the provider. The corrected investigation report is retained in `work/diagnostics/fresh-sms-read.json`; its narrative is `work/diagnostics/FRESH-SMS-FINDINGS.md` in the execution workspace. Unrelated bodies and OTP values were omitted.

The rebuild also reproduced and corrected separate defects:

- Absolute `since=0` was reported alongside the misleading default `agoText: "30s"`. The effective threshold was already zero; now `requested.timeFilter` identifies it and the relative text is omitted.
- A whitespace-only `since` value was coerced to zero by numeric validation. Blank numeric and repeated query values now return 400 before provider work.
- Inbox rows with an unsupported timestamp format could be dropped. ReceiveASMSOnline's actual `YYYY MM DD - HH:mm` grammar is now handled; its UK repeat read changed from an explicit parsing failure to 47 valid messages. The archive's age remains visible.
- A hydrated application shell could previously resemble an empty inbox. Readiness now requires actual message rows or an explicit empty state. Entirely unparseable nonempty rows return 502 with available drop diagnostics.
- Disabled sources, unsupported countries, timeout errors and upstream failures now remain distinct from a successful empty match. API responses use `Cache-Control: no-store`.

These fixes improve observability and correctness. They do not explain away a marker that was absent from the provider's own visible inbox, and they do not create fresh delivery evidence.

## Controlled delivery-test evidence

`POST /api/delivery-tests` reads a baseline before returning a generated dummy message and test ID. The API sends no SMS. A user must send the returned text externally, then check `GET /api/delivery-tests/:id`.

A test starts `pending`. It becomes `received` only when the exact unique marker and expected code text, absent from the baseline, appear in a parsed provider message within the test's timestamp window and expected provider URL. The probe records provider URL, message timestamp, observed time and message length without copying unrelated SMS bodies. `evidence.otpMatched` separately records whether the extractor returned that expected code; it may be false even when the code text was observed. A test that reaches its deadline becomes `expired`; failures leave delivery unverified.

Redis stores records for 24 hours from creation by default, preserving their original retention TTL during updates. The default observation window is ten minutes, creation attempts are limited globally to 20 per minute, and checks share a three-second cooldown plus a per-test lease. No server-side sending or scheduled probe polling is created. The frontend checks while its delivery card is active and stops on terminal state, error, manual stop or navigation.

This release's real public-provider evidence contains **no observed newly sent controlled SMS**. A successful parser fixture, a readable historical inbox and a pending probe are not recorded as a real delivery pass. The [README procedure](../README.md#controlled-fresh-sms-check) provides the exact manual steps needed to obtain per-test evidence.

## Deployment scope and previous deployment evidence

The project uses a dedicated Cloudflare Tunnel for `number-api.inboxcloudkit.xyz`, forwarding only that hostname to the private Docker API on port 3030. The catchall returns 404; Redis has no public port. Tunnel credentials remain outside the Git checkout. The root InboxCloudKit website, root/www DNS records and unrelated tunnel remain separate.

The initial deployment, before this rebuild, verified health, Swagger, country/source routes, real historical inbox reads, CORS, Redis persistence/recovery and graceful Compose lifecycle. Its [GitHub Actions run](https://github.com/Kirsh2029/free-otp-api/actions/runs/42076097570) belongs to application/documentation commit `a2a4277955474b59f41784df3f79afb5a66fbaa7`. Those historical checks do not by themselves establish that a new Docker image contains the rebuild or that any fresh SMS was received.

The existing public host is the user's Mac through a dedicated Colima Docker profile. Availability depends on the Mac, its network and Colima remaining running. See [deployment.md](deployment.md) for the isolated subdomain, tunnel and always-on-host migration procedure. The rebuilt Docker image and subsequent public checks are recorded below. GitHub Actions independently repeats installs, builds, tests, browser fixtures and Docker health checks on each pushed revision.


## Rebuilt Docker runtime

Application source through `63a3ec65b78bf47a4db7e920b90d5df71b2a6120` was rebuilt into image `sha256:c65ccf8fea2fc256a27146b959df58e47886fe38675699765793d89657c3b0ae`. All **45 compiled JavaScript files** matched the frozen local build by SHA256. The packaged **Node 24.22.2 / Chrome 156.0.8078.47** browser launched and rendered successfully. The API was recreated with this image and became healthy; Redis and the dedicated connector were retained.
