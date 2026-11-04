export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2"><div className="h-3 w-24 animate-pulse rounded bg-muted" /><div className="h-8 w-64 animate-pulse rounded bg-muted" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />)}</div>
      <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-muted/30" />)}</div>
    </div>
  );
}
