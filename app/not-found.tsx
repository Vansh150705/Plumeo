import Link from 'next/link';
import { Feather } from 'lucide-react';

/** Shown for any unmatched route or an explicit notFound() call. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <Feather className="size-8 text-primary" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
      >
        Back home
      </Link>
    </div>
  );
}
