import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Target } from 'lucide-react';

export default async function AdminSettings() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const { data: areas } = await supabase.from('thrust_areas').select('*').order('name');

  return (
    <AppShell role="Admin">
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Configuration</div>
          <h1 className="font-serif text-4xl tracking-tight">Settings</h1>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2"><Target className="size-4 text-primary" /> Thrust areas</div>
              <Pill variant="gold">{areas?.length ?? 0}</Pill>
            </div>
            <div className="divide-y divide-border">
              {(areas ?? []).map(a => (
                <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                    <Target className="size-3.5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.description}</div>
                  </div>
                  {a.is_active ? <Pill variant="green">Active</Pill> : <Pill variant="gray">Inactive</Pill>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
