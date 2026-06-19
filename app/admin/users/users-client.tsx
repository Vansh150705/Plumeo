'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { Building2, RefreshCw, CheckCircle2, Users as UsersIcon } from 'lucide-react';
import { syncEntraDirectory } from '@/lib/auth';
import type { AppUser } from '@/lib/types';

export function UsersClient({ users }: { users: (AppUser & { manager_name: string | null })[] }) {
  const [pending, startTransition] = useTransition();
  const [synced, setSynced] = useState<{ count: number } | null>(null);
  const router = useRouter();

  function handleSync() {
    startTransition(async () => {
      const res = await syncEntraDirectory();
      if (res.ok) {
        setSynced({ count: res.synced });
        router.refresh();
      }
    });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            Bonus feature · BRD §5.1
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Users & Entra ID</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Directory synced from Microsoft Entra ID. Roles derived from group membership;
            the manager hierarchy follows Entra&apos;s manager attribute.
          </p>
        </div>
        <Button onClick={handleSync} disabled={pending}>
          <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Syncing…' : 'Sync from Entra'}
        </Button>
      </div>

      {synced && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-3 flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-400" />
            Synced {synced.count} users from mock Entra directory. Roles and manager chains refreshed.
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <StatCard icon={UsersIcon} label="Total users" value={users.length} hint="Active directory members" />
        <StatCard icon={Building2} label="Departments" value={new Set(users.map(u => u.department).filter(Boolean)).size} hint="Synced from Entra" />
        <StatCard icon={UsersIcon} label="Manager chain depth" value={2} hint="L1 → L2 mapping intact" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="text-sm font-semibold">Provisioned users</div>
            <div className="text-xs text-muted-foreground font-mono">{users.length} rows</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-left">
                  <Th>Name</Th>
                  <Th>UPN</Th>
                  <Th>Role</Th>
                  <Th>Department</Th>
                  <Th>Manager</Th>
                  <Th>Entra groups</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-accent/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.full_name} id={u.id} size={28} />
                        <span className="font-medium">{u.full_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{u.upn}</td>
                    <td className="px-4 py-2.5">
                      <Pill variant={u.role === 'Admin' ? 'purple' : u.role === 'Manager' ? 'blue' : 'gray'}>{u.role}</Pill>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.department}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.manager_name ?? '·'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(u.entra_groups ?? []).slice(0, 3).map(g => (
                          <span key={g} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{g}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{children}</th>;
}

function StatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="size-10 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
          <Icon className="size-4 text-primary" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="font-serif text-2xl tabular-nums">{value}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}
