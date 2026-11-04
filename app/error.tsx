'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div className="max-w-md"><h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">We hit an unexpected problem. Your data is safe — try again, and if it keeps happening share this reference with your administrator{error.digest ? `: ${error.digest}` : '.'}</p>
        <Button className="mt-6" onClick={reset}>Try again</Button></div>
    </div>
  );
}
