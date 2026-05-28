import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogOut, Mail, Moon, RefreshCw, ShieldCheck, Sun, Trash2, User, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'

function getProviderLabel(provider) {
  if (provider === 'password_google') return 'Email + Google'
  if (provider === 'google') return 'Google'
  return 'Email'
}

function Avatar({ user }) {
  const initial = user?.username?.slice(0, 1)?.toUpperCase() || 'A'

  if (user?.avatar_url) {
    return (
      <img
        className="h-14 w-14 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-white/15"
        src={user.avatar_url}
        alt={`${user.username} avatar`}
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-comet to-solar text-lg font-bold text-slate-950">
      {initial}
    </span>
  )
}

export default function SettingsModal({
  open,
  onClose,
  onClearConversations,
  conversationCount = 0,
}) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const providerLabel = getProviderLabel(user?.auth_provider)

  if (!open) {
    return null
  }

  async function switchAccount() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function clearAll() {
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }

    setClearing(true)
    try {
      await onClearConversations?.()
      setConfirmingClear(false)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <motion.section
        className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-orbit"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Settings</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Workspace preferences</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]">
          <div className="flex items-center gap-4">
            <Avatar user={user} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-950 dark:text-white">{user?.username}</p>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:border-comet/25 dark:bg-comet/10 dark:text-comet">
                <ShieldCheck className="h-3.5 w-3.5" />
                {providerLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
            onClick={toggleTheme}
          >
            <span className="flex items-center gap-3">
              {theme === 'dark' ? <Moon className="h-5 w-5 text-comet" /> : <Sun className="h-5 w-5 text-solar" />}
              <span>
                <span className="block font-medium text-slate-950 dark:text-white">Appearance</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Current mode: {theme}
                </span>
              </span>
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              Toggle
            </span>
          </button>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
              <User className="mb-3 h-5 w-5 text-sky-600 dark:text-comet" />
              <p className="text-sm font-medium text-slate-950 dark:text-white">Profile</p>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{user?.username}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
              <Mail className="mb-3 h-5 w-5 text-sky-600 dark:text-comet" />
              <p className="text-sm font-medium text-slate-950 dark:text-white">Email</p>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
            onClick={clearAll}
            disabled={clearing || conversationCount === 0}
          >
            <span className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-red-500" />
              <span>
                <span className="block font-medium text-slate-950 dark:text-white">
                  {confirmingClear ? 'Confirm clear conversations' : 'Clear conversations'}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {conversationCount} saved {conversationCount === 1 ? 'conversation' : 'conversations'}
                </span>
              </span>
            </span>
            {clearing && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
          </button>

          {confirmingClear && (
            <button
              type="button"
              className="w-full rounded-2xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel clear
            </button>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="secondary-button w-full" onClick={switchAccount}>
              <RefreshCw className="h-4 w-4" />
              Switch account
            </button>
            <button type="button" className="secondary-button w-full text-red-600 dark:text-red-200" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
