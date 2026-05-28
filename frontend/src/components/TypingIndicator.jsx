export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2" aria-label="AI is typing">
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-comet" />
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-aurora [animation-delay:160ms]" />
      <span className="h-2 w-2 animate-pulse-dot rounded-full bg-solar [animation-delay:320ms]" />
    </div>
  )
}
