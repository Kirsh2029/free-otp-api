export type FrontendEnvironment = Record<string, string | boolean | undefined>;

/** Frontend build config: never imports the backend environment or credentials. */
export function resolveApiConfig(env: FrontendEnvironment) {
  const explicit = env.VITE_API_BASE_URL || env.REACT_APP_API_BASE_URL;
  const host = env.REACT_APP_API_HOST;
  const configured = explicit || (host
    ? `${env.REACT_APP_API_PROTOCOL || 'http'}://${host}/api`
    : 'https://number-api.inboxcloudkit.xyz/api');
  let url: URL;
  try {
    url = new URL(String(configured));
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  const baseUrl = url.toString().replace(/\/+$/, '');
  return { baseUrl, root: url.origin, swaggerUrl: `${url.origin}/docs` };
}
