export class ApiResponseError extends Error {
  constructor(message: string, public statusCode: number, public data?: unknown) { super(message); }
}

/** Keep gateway/HTML failures distinct from a readable empty inbox. */
export async function readApiResponse<T>(response: Response): Promise<T> {
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ApiResponseError(response.ok ? 'The API returned an invalid JSON response' : `API request failed (${response.status})`, response.status); }
  if (!response.ok) {
    const error = body as { message?: unknown; error?: unknown } | null;
    throw new ApiResponseError(typeof error?.message === 'string' ? error.message : typeof error?.error === 'string' ? error.error : `API request failed (${response.status})`, response.status, body);
  }
  return body as T;
}
