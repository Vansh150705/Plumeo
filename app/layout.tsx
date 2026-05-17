import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AtomQuest — Goal Setting & Tracking Portal',
  description: 'Enterprise OKR & performance management. Built for AtomQuest Hackathon 2026.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground grain antialiased">
        {children}
      </body>
    </html>
  );
}
