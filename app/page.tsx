import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingClient } from './landing-client';

export default async function HomePage() {
  // If already signed in, route to the correct dashboard
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
    if (appUser?.role === 'Admin')   redirect('/admin');
    if (appUser?.role === 'Manager') redirect('/manager');
    if (appUser?.role === 'Employee') redirect('/employee');
  }
  return <LandingClient />;
}
