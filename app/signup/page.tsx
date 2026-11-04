import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { SignupForm } from './signup-form';
import { config } from '@/server/core/config';

export const metadata: Metadata = { title: 'Create your workspace' };
export const dynamic = 'force-dynamic';

export default function SignupPage() {
  if (!config().allowSignup) {
    return <AuthCard title="Sign-up is disabled" subtitle="Ask your platform administrator to create your organisation, or sign in if you already have an account." footer={<Link href="/login" className="font-medium text-foreground underline underline-offset-4">Back to sign in</Link>}><span /></AuthCard>;
  }
  return (
    <AuthCard title="Create your workspace" subtitle="You will be the first administrator. Invite your people once you are in."
      footer={<>Already have a workspace? <Link href="/login" className="font-medium text-foreground underline underline-offset-4">Sign in</Link></>}>
      <SignupForm />
    </AuthCard>
  );
}
