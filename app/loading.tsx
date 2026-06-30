export default function Loading() {
  return (
    <div className="flex min-h-screen">
      <div className="w-60 shrink-0 border-r border-border bg-card/50 p-5 space-y-3 hidden md:block">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="size-8 rounded-lg bg-muted animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-muted animate-pulse" />
            <div className="h-2 w-12 rounded bg-muted/60 animate-pulse" />
          </div>
        </div>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-7 rounded-md bg-muted/40 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 px-4 sm:px-6 border-b border-border flex items-center gap-3">
          <div className="h-3 w-20 rounded bg-muted/60 animate-pulse" />
          <div className="h-5 w-20 rounded-full bg-muted/40 animate-pulse" />
        </div>
        <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
            <div className="h-10 w-64 rounded bg-muted animate-pulse" />
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl border border-border bg-muted/30 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl border border-border bg-muted/20 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}