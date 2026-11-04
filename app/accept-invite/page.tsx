import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { AcceptForm } from './accept-form';

export const metadata: Metadata = { title: 'Set your password' };
export default function AcceptInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  return <AuthCard title="Choose your password" subtitle="This secure link works once. After this you can sign in normally."><AcceptForm token={searchParams.token ?? ''} /></AuthCard>;
}
