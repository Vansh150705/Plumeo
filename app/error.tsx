'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Root error boundary. Catches any uncaught error thrown while rendering a
 * route segment or its server components so the user sees a calm recovery
 * screen instead of a blank crash.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production this is where an error reporter (Sentry, etc.) would hook in.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error interrupted this page. You can try again — your data is safe.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}
      </div>
      <button
        onClick={reset}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        <RefreshCw className="size-4" />
        Try again
      </button>
    </div>
  );
}
