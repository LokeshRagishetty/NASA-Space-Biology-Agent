import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth()

  if (isAuthenticated) {
    return <Navigate to="/app" replace />
  }

  return children
}
