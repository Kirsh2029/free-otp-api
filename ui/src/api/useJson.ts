import { useEffect, useState } from 'react';
import { baseUrl } from './index';
import { loadPhonePages } from './phonePages';
import { readApiResponse } from './response';
import type { PhonesResponse } from '../types';

/** Abort stale requests when routes change, and retain HTTP errors in the UI. */
export function useJson<T>(endpoint: string, revision = 0, collectPhonePages = false) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    const get = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
      return readApiResponse<unknown>(response);
    };
    const request = collectPhonePages
      ? loadPhonePages((page, limit) => get(`${endpoint}?${new URLSearchParams({ page: String(page), limit: String(limit) })}`) as Promise<PhonesResponse>)
      : get(endpoint);
    request.then((body) => {
        if (!controller.signal.aborted) setState({ data: body as T, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ error: error instanceof Error ? error.message : String(error), loading: false });
        }
      });
    return () => controller.abort();
  }, [endpoint, revision, collectPhonePages]);
  return state;
}
