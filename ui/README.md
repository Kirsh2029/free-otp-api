# Number API frontend

A separate React 18 single-page application using Vite, TypeScript, and Ant Design. Building this UI does not publish or modify the existing InboxCloudKit website.

Requires Node.js 24 or newer. From the repository root:

```sh
cp ui/.env.example ui/.env
npm --prefix ui ci
npm --prefix ui start
```

Development runs at `http://localhost:5173`. To use your local backend, set `VITE_API_BASE_URL=http://localhost:3030/api` in `ui/.env`; restart Vite after environment edits. Production defaults to `https://number-api.inboxcloudkit.xyz/api`.

Frontend variables are public build-time values, independent of backend configuration. Do not put passwords or tokens in them.

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | Preferred absolute HTTP(S) API base, including `/api`; trailing slashes are normalized. |
| `REACT_APP_API_BASE_URL` | Legacy fallback when the preferred variable is absent. |
| `REACT_APP_API_HOST` | Legacy host and optional port; appends `/api`. |
| `REACT_APP_API_PROTOCOL` | Protocol for legacy host configuration, default `http`. |

Invalid URLs, embedded credentials, query strings, and fragments are rejected. Values resolve in the listed priority order. API path parameters and query parameters are encoded separately. Source failures remain visible, including partial phone-list failures. Empty inboxes can be refreshed. Phone listings follow all API pages before client search/source grouping; bounded or interrupted pagination displays a warning. Supported providers expose previous/next inbox-page controls. The browser smoke command uses clearly identified HTTP fixtures, not real public SMS inboxes.

```sh
npm --prefix ui test
npm --prefix ui run build
npm --prefix ui run preview
# In another terminal (after installing root dependencies):
npm --prefix ui run smoke
```

Upload `ui/dist/` only to a separately configured frontend host if desired. Configure SPA fallback to `index.html` for `/phones/*` and `/messages/*`. Add that frontend origin to backend `CORS_ORIGINS` before using a different host. The API and Swagger continue to use their isolated API subdomain.

The browser reads public shared SMS inboxes. Use only for authorized testing; never send confidential messages or use these numbers for sensitive accounts.
