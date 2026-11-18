import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Toaster } from 'sonner';
import { NavigationProgress } from '@/components/navigation-progress';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plumeo',
  description: 'Plumeo runs the whole goal lifecycle: drafting, manager approval, quarterly check-ins, and an audit trail that never forgets. Built on Next.js, Supabase, and Vercel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('plumeo-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
        <Toaster richColors closeButton position="bottom-right" theme="system" />
      </body>
    </html>
  );
}