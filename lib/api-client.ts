'use client';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: any) { super(message); }
}

/** Typed fetch wrapper for the Plumeo REST API (same-origin, cookie session). */
export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message ?? 'Something went wrong.', res.status, json?.error?.code ?? 'error', json?.error?.details);
  return (json?.data ?? json) as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown, h?: Record<string, string>) => api<T>('POST', p, b ?? {}, h);
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);
