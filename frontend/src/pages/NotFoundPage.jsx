import { Link } from 'react-router-dom'
import { Orbit } from 'lucide-react'
import PageTransition from '../components/PageTransition'

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950 dark:bg-space-radial dark:text-white">
      <PageTransition className="glass-panel max-w-md rounded-[2rem] p-8 text-center">
        <Orbit className="mx-auto mb-4 h-12 w-12 text-comet" />
        <h1 className="text-3xl font-semibold">Lost signal</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          This route is outside the current mission path.
        </p>
        <Link to="/app" className="primary-button mt-6">
          Return to dashboard
        </Link>
      </PageTransition>
    </main>
  )
}
