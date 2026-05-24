import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Globe, Lock, Mail, Rocket } from 'lucide-react'
import AuthLayout from '../layouts/AuthLayout'
import LoadingSpinner from '../components/LoadingSpinner'
import PageTransition from '../components/PageTransition'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, loginWithGoogle } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    try {
      await login({ username: form.email.trim(), password: form.password })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    setNotice('')
    setGoogleLoading(true)

    try {
      await loginWithGoogle()
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue your NASA space biology research workspace."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-semibold text-comet hover:text-aurora">
            Create an account
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

          {notice && (
            <div className="rounded-2xl border border-comet/30 bg-comet/10 p-3 text-sm text-comet">
              {notice}
            </div>
          )}

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300 light:text-slate-700">
              <Mail className="h-4 w-4" />
              Email or username
            </span>
            <input
              className="field"
              type="text"
              name="email"
              autoComplete="email"
              value={form.email}
              onChange={updateField}
              placeholder="astro.researcher@nasa.local"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300 light:text-slate-700">
              <Lock className="h-4 w-4" />
              Password
            </span>
            <span className="relative block">
              <input
                className="field pr-12"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={form.password}
                onChange={updateField}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white light:hover:text-slate-900"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-slate-400 light:text-slate-600">
              <input className="h-4 w-4 rounded border-white/20 bg-white/10" type="checkbox" />
              Remember me
            </label>
            <Link to="/forgot-password" className="font-medium text-comet hover:text-aurora">
              Forgot password?
            </Link>
          </div>

          <button className="primary-button w-full" type="submit" disabled={loading}>
            {loading ? <LoadingSpinner label="Signing in" /> : <><Rocket className="h-4 w-4" /> Sign in</>}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10 light:bg-slate-200" />
          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">or</span>
          <div className="h-px flex-1 bg-white/10 light:bg-slate-200" />
        </div>

        <button className="secondary-button w-full" type="button" onClick={handleGoogle} disabled={googleLoading}>
          {googleLoading ? <LoadingSpinner label="Connecting" /> : <><Globe className="h-4 w-4" /> Continue with Google</>}
        </button>
      </PageTransition>
    </AuthLayout>
  )
}
