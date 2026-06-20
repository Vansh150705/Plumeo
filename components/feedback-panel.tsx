'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Pill } from '@/components/ui/pill';
import { Avatar } from '@/components/ui/avatar';
import { Star, MessageSquarePlus, Lock, Trash2 } from 'lucide-react';
import { giveFeedback, withdrawFeedback } from '@/lib/actions';
import type { FeedbackWithAuthor, FeedbackVisibility } from '@/lib/types';
import { cn, fmtDate } from '@/lib/utils';

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={cn('transition', onChange && 'hover:scale-110')}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
        >
          <Star className={cn('size-4', n <= value ? 'fill-primary text-primary' : 'text-muted-foreground/40')} />
        </button>
      ))}
    </div>
  );
}

export function FeedbackPanel({
  subjectId,
  subjectName,
  currentUserId,
  canGive,
  initialFeedback,
}: {
  subjectId: string;
  subjectName: string;
  currentUserId: string;
  canGive: boolean;
  initialFeedback: FeedbackWithAuthor[];
}) {
  const [items, setItems] = useState<FeedbackWithAuthor[]>(initialFeedback);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [visibility, setVisibility] = useState<FeedbackVisibility>('Manager');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (rating === 0) return setError('Pick a rating.');
    if (comment.trim().length === 0) return setError('Add a comment.');
    start(async () => {
      const res = await giveFeedback({ subject_id: subjectId, rating, comment, visibility });
      if (res.ok) {
        setItems((prev) => [{ ...res.feedback, author: { id: currentUserId, full_name: 'You' } } as FeedbackWithAuthor, ...prev]);
        setRating(0);
        setComment('');
      } else {
        setError(res.error);
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await withdrawFeedback(id);
      if (res.ok) setItems((prev) => prev.filter((f) => f.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquarePlus className="size-4 text-primary" />
        <h3 className="font-medium text-sm">360° feedback{subjectName ? ` · ${subjectName}` : ''}</h3>
      </div>

      {canGive && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Leave feedback</span>
              <Stars value={rating} onChange={setRating} />
            </div>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={`What did ${subjectName || 'they'} do well, and where could they grow?`}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 text-xs">
                {(['Manager', 'Private'] as FeedbackVisibility[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={cn(
                      'px-2.5 py-1 rounded-md border transition',
                      visibility === v ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v === 'Manager' ? 'Shared with them' : 'Private to management'}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={submit} disabled={pending}>
                {pending ? 'Saving…' : 'Submit'}
              </Button>
            </div>
            {error && <div className="text-xs text-orange-400">{error}</div>}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
            No feedback yet.
          </div>
        )}
        {items.map((f) => (
          <Card key={f.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={f.author?.full_name ?? '?'} id={f.author_id} size={28} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{f.author?.full_name ?? 'Someone'}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(f.created_at)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Stars value={f.rating} />
                  {f.visibility === 'Private' && (
                    <Pill variant="gray"><Lock className="size-3" /> Private</Pill>
                  )}
                  {f.author_id === currentUserId && (
                    <button onClick={() => remove(f.id)} className="text-muted-foreground hover:text-red-400 transition" aria-label="Withdraw feedback">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{f.comment}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
