'use client';

import { useState, useTransition } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Pill } from '@/components/ui/pill';
import { Sparkles, Wand2, AlertCircle, Plus } from 'lucide-react';
import { draftGoalsFromBrief, type DraftedGoal } from '@/lib/ai';
import { uomLabel, formatTarget } from '@/lib/goals';
import type { Goal } from '@/lib/types';

/**
 * Plain-language → draft goals. The assistant only proposes; applying a draft
 * runs it through the editor's normal upsert path, so nothing skips validation.
 */
export function AiGoalAssistant({
  onApply,
  disabled,
}: {
  onApply: (goals: Partial<Goal>[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [drafts, setDrafts] = useState<DraftedGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [applying, startApplying] = useTransition();

  function generate() {
    setError(null);
    startGenerating(async () => {
      const res = await draftGoalsFromBrief(brief);
      if (res.ok) {
        setDrafts(res.goals);
      } else {
        setError(res.error);
        setDrafts(null);
      }
    });
  }

  function apply() {
    if (!drafts) return;
    startApplying(async () => {
      await onApply(drafts as Partial<Goal>[]);
      setOpen(false);
      setBrief('');
      setDrafts(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          disabled={disabled}
          className="w-full p-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition flex items-center justify-center gap-2 text-sm text-primary disabled:opacity-50"
        >
          <Sparkles className="size-4" /> Draft goals with AI
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> AI goal assistant
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Describe your role and what you want to achieve this cycle. The assistant proposes a
              draft sheet you can edit before saving.
            </p>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="e.g. I lead the SMB sales pod. I want to grow new-logo revenue, lift renewal rates, and ship our onboarding revamp on time."
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-orange-400">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {drafts && (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {drafts.map((g, i) => (
                <div key={i} className="rounded-lg border border-border bg-card/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-sm">{g.title}</div>
                    <Pill variant="gold">{g.weightage}%</Pill>
                  </div>
                  {g.description && (
                    <div className="text-xs text-muted-foreground mt-1">{g.description}</div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                    <Pill>{g.thrust_area}</Pill>
                    <Pill>{uomLabel(g.uom, g.direction)}</Pill>
                    <Pill>Target {formatTarget(g)}</Pill>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={generate} disabled={generating || applying}>
              <Sparkles className="size-4" />
              {generating ? 'Thinking…' : drafts ? 'Regenerate' : 'Generate'}
            </Button>
            {drafts && (
              <Button onClick={apply} disabled={applying}>
                <Plus className="size-4" />
                {applying ? 'Adding…' : `Add ${drafts.length} goals to sheet`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
