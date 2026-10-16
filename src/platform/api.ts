/**
 * A small typed fetch wrapper for the Go API.
 *
 * - Same-origin only: the session is an HttpOnly cookie the browser attaches
 *   itself; JavaScript never sees a token.
 * - Every request carries `X-Requested-With`, which the server requires on
 *   writes as a CSRF guard (another site can't add custom headers without a
 *   CORS preflight the server never approves).
 * - Errors come back as `ApiError` with the server's machine-readable code and
 *   field-level problems, so forms can point at the field to fix.
 */

/** Same-origin API prefix. Vite's dev server and Vercel both route it to the Go backend. */
export const API_BASE = '/api';

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly problems: FieldProblem[];

  constructor(status: number, code: string, message: string, problems: FieldProblem[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Abort after this many ms (default 20s). */
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = error && typeof error.code === 'string' ? error.code : `http_${status}`;
  const message = error && typeof error.message === 'string' ? error.message : `Request failed (${status}).`;
  const problems: FieldProblem[] = [];
  if (error && Array.isArray(error.problems)) {
    for (const p of error.problems) {
      if (isRecord(p) && typeof p.field === 'string' && typeof p.message === 'string') problems.push({ field: p.field, message: p.message });
    }
  }
  return new ApiError(status, code, message, problems);
}

/** Low-level request returning the raw Response (for downloads). */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'frontend-loop' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new ApiError(0, 'timeout', 'The server took too long to answer.');
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** JSON request. Resolves with the parsed body or rejects with ApiError. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) throw parseError(res.status, body);
  return body as T;
}

/** Trigger a browser download of an API file response (exports). */
export async function downloadFrom(path: string, fallbackName: string): Promise<void> {
  const res = await apiFetch(path, { timeoutMs: 60_000 });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw parseError(res.status, body);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
