import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, KeyRound, Mail } from 'lucide-react'
import AuthLayout from '../layouts/AuthLayout'
import LoadingSpinner from '../components/LoadingSpinner'
import PageTransition from '../components/PageTransition'
import { sendFirebasePasswordReset } from '../services/firebase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      await sendFirebasePasswordReset(email.trim())
      setSuccess('If this Firebase account exists, a reset link has been sent.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reset access"
      subtitle="Use Firebase password reset when Google/Firebase auth is configured."
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="font-semibold text-comet hover:text-aurora">
            Back to login
          </Link>
        </>
      }
    >
      <PageTransition>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="flex gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100 light:text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex gap-3 rounded-2xl border border-aurora/30 bg-aurora/10 p-3 text-sm text-aurora light:text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300 light:text-slate-700">
              <Mail className="h-4 w-4" />
              Email
            </span>
            <input
              className="field"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="mission.specialist@nasa.local"
              required
            />
          </label>

          <button className="primary-button w-full" type="submit" disabled={loading}>
            {loading ? <LoadingSpinner label="Sending" /> : <><KeyRound className="h-4 w-4" /> Send reset link</>}
          </button>
        </form>
      </PageTransition>
    </AuthLayout>
  )
}
