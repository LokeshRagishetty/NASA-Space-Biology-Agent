export function HistorySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-2xl bg-white/[0.07] light:bg-slate-200"
        />
      ))}
    </div>
  )
}

export function ChatSkeleton() {
  return (
    <div className="space-y-5">
      <div className="ml-auto h-14 w-2/3 animate-pulse rounded-3xl bg-comet/20" />
      <div className="h-28 w-5/6 animate-pulse rounded-3xl bg-white/[0.07] light:bg-slate-200" />
      <div className="ml-auto h-14 w-1/2 animate-pulse rounded-3xl bg-comet/20" />
    </div>
  )
}
