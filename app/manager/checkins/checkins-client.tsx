'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Pill, StatusPill } from '@/components/ui/pill';
import { CheckInWorkspace } from '@/components/checkin-workspace';
import { FeedbackPanel } from '@/components/feedback-panel';
import type { Goal, GoalSheet, CheckIn, Cycle, CheckInQuarter, AppUser, FeedbackWithAuthor } from '@/lib/types';
import { cn } from '@/lib/utils';

type SheetWithGoals = GoalSheet & { goals: Goal[] };

export function ManagerCheckinsClient({
  reports, sheets, checkIns, feedback, currentUserId, cycle, currentQuarter,
}: {
  reports: AppUser[];
  sheets: SheetWithGoals[];
  checkIns: CheckIn[];
  feedback: FeedbackWithAuthor[];
  currentUserId: string;
  cycle: Cycle;
  currentQuarter: CheckInQuarter;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const selected = reports.find(r => r.id === selectedId);
  const sheet = sheets.find(s => s.employee_id === selectedId);
  const goalsIds = sheet?.goals.map(g => g.id) ?? [];
  const myCheckIns = checkIns.filter(c => goalsIds.includes(c.goal_id));
  const subjectFeedback = feedback.filter(f => f.subject_id === selectedId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <aside className="w-72 shrink-0 border-r border-border bg-card/50 overflow-y-auto">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Your team</div>
        </div>
        <div className="divide-y divide-border">
          {reports.map(r => {
            const s = sheets.find(x => x.employee_id === r.id);
            const isSel = r.id === selectedId;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn('w-full px-4 py-3 text-left hover:bg-accent transition flex items-center gap-3', isSel && 'bg-accent')}
              >
                <Avatar name={r.full_name} id={r.id} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.full_name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.department}</div>
                </div>
                {s ? <StatusPill status={s.status} /> : <Pill variant="gray">·</Pill>}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        {selected && sheet ? (
          <div>
            <CheckInWorkspace
              goals={sheet.goals}
              checkIns={myCheckIns}
              currentQuarter={currentQuarter}
              cycle={cycle}
              sheetStatus={sheet.status}
              viewerRole="Manager"
              employeeName={selected.full_name}
            />
            <div className="px-8 pb-10 max-w-4xl">
              <FeedbackPanel
                subjectId={selected.id}
                subjectName={selected.full_name}
                currentUserId={currentUserId}
                canGive
                initialFeedback={subjectFeedback}
              />
            </div>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {!selected ? 'Select a team member.' : 'This person has no sheet yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
