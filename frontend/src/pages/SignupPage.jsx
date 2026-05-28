import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import AuthLayout from '../layouts/AuthLayout'
import LoadingSpinner from '../components/LoadingSpinner'
import PageTransition from '../components/PageTransition'
import { useAuth } from '../hooks/useAuth'

function makeUsername(email) {
  return email?.split('@')?.[0]?.replace(/[^A-Za-z0-9_.-]/g, '.')?.slice(0, 40) || ''
}

export default function SignupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signup } = useAuth()
  const googleProfile = location.state?.googleProfile
  const initialEmail = googleProfile?.email || ''
  const [form, setForm] = useState({
    username: makeUsername(initialEmail),
    email: initialEmail,
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(location.state?.message || '')

  const passwordMismatch = useMemo(
    () => form.confirmPassword && form.password !== form.confirmPassword,
    [form.confirmPassword, form.password],
  )

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function validate() {
    if (form.username.trim().length < 3) return 'Username must be at least 3 characters.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return 'Enter a valid email.'
    if (form.password.length < 8) return 'Password must be at least 8 characters.'
    if (form.password !== form.confirmPassword) return 'Passwords do not match.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      await signup({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Start a secure research account for private AI conversations and saved NASA chats."
      footer={
        <>
          Already have access?{' '}
          <Link to="/login" className="font-semibold text-comet hover:text-aurora">
            Sign in
          </Link>
        </>
      }
    >
      <PageTransition>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-aurora/30 dark:bg-aurora/10 dark:text-aurora">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <User className="h-4 w-4" />
              Username
            </span>
            <input
              className="field"
              type="text"
              name="username"
              autoComplete="username"
              value={form.username}
              onChange={updateField}
              placeholder="mission.specialist"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Mail className="h-4 w-4" />
              Email
            </span>
            <input
              className="field"
              type="email"
              name="email"
              autoComplete="email"
              value={form.email}
              onChange={updateField}
              placeholder="mission.specialist@nasa.local"
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Lock className="h-4 w-4" />
              Password
            </span>
            <span className="relative block">
              <input
                className="field pr-12"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                value={form.password}
                onChange={updateField}
                placeholder="Minimum 8 characters"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Lock className="h-4 w-4" />
              Confirm password
            </span>
            <input
              className={`field ${passwordMismatch ? 'border-red-400/60' : ''}`}
              type={showPassword ? 'text' : 'password'}
              name="confirmPassword"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={updateField}
              placeholder="Repeat password"
              required
            />
          </label>

          <button className="primary-button w-full" type="submit" disabled={loading || passwordMismatch}>
            {loading ? <LoadingSpinner label="Creating workspace" /> : 'Create account'}
          </button>
        </form>
      </PageTransition>
    </AuthLayout>
  )
}
