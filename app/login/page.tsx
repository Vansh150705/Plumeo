import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { LoginForm } from './login-form';
import { config } from '@/server/core/config';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { org?: string; error?: string } }) {
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your organisation's workspace."
      footer={config().allowSignup ? <>New to Plumeo? <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">Create a workspace</Link></> : undefined}>
      <LoginForm defaultOrg={searchParams.org ?? ''} initialError={searchParams.error} />
    </AuthCard>
  );
}
