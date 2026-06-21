import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NavigationProgress } from '@/components/navigation-progress';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plumeo',
  description: 'Plumeo runs the whole goal lifecycle: drafting, manager approval, quarterly check-ins, and an audit trail that never forgets. Built on Next.js, Supabase, and Vercel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}