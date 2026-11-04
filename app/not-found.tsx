import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div><p className="font-display text-6xl text-[hsl(var(--gold))]">404</p><h1 className="mt-2 text-xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may have moved, or you may not have access to it.</p>
        <Button asChild className="mt-6"><Link href="/app">Back to Plumeo</Link></Button></div>
    </div>
  );
}
