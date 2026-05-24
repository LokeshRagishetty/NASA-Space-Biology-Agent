import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ children }) {
  const { booting, isAuthenticated } = useAuth()
  const location = useLocation()

  if (booting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-space-radial">
        <Loader2 className="h-8 w-8 animate-spin text-comet" />
      </main>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}
