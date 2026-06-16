import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NavigationProgress } from '@/components/navigation-progress';
import './globals.css';

export const metadata: Metadata = {
  title: 'AtomQuest — Goal Setting & Tracking Portal',
  description: 'A structured portal for the full goal lifecycle — creation, manager approval, quarterly check-ins, and audit-ready visibility. Built on Next.js, Supabase, and Vercel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground grain antialiased">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}