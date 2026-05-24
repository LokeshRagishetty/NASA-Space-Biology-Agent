import { Loader2 } from 'lucide-react'

export default function LoadingSpinner({ label = 'Loading' }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  )
}
