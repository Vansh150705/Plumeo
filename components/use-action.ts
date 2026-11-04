'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';

/** Runs an API mutation with loading state, error/success toasts and a server-data refresh. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, opts: { success?: string; refresh?: boolean; silent?: boolean } = {}): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (opts.success) toast.success(opts.success);
      if (opts.refresh !== false) router.refresh();
      return r;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : 'Something went wrong.', 0, 'error');
      setError(err);
      if (!opts.silent) toast.error(err.message);
      return undefined;
    } finally { setBusy(false); }
  }, [router]);
  return { run, busy, error };
}
