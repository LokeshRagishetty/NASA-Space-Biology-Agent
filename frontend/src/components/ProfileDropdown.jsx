import { useState } from 'react'
import { ChevronDown, LogOut, Settings, UserCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

function renderAvatar(user, initial, size = 'h-9 w-9') {
  if (user?.avatar_url) {
    return (
      <img
        className={`${size} rounded-xl object-cover ring-1 ring-slate-200 dark:ring-white/15`}
        src={user.avatar_url}
        alt={`${user.username} avatar`}
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <span className={`flex ${size} items-center justify-center rounded-xl bg-gradient-to-br from-comet to-solar text-sm font-bold text-slate-950`}>
      {initial}
    </span>
  )
}

export default function ProfileDropdown({ onSettings }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const initial = user?.username?.slice(0, 1)?.toUpperCase() || 'A'
  const providerLabel =
    user?.auth_provider === 'password_google'
      ? 'Email + Google'
      : user?.auth_provider === 'google'
        ? 'Google'
        : 'Email'

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.10]"
        onClick={() => setOpen((value) => !value)}
      >
        {renderAvatar(user, initial)}
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block truncate text-sm font-semibold text-slate-950 dark:text-white">
            {user?.username}
          </span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {user?.email}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <div className="glass-panel absolute right-0 mt-3 w-64 rounded-2xl p-2">
          <div className="border-b border-slate-200 px-3 py-3 dark:border-white/10">
              <div className="flex items-center gap-3">
              {user?.avatar_url ? renderAvatar(user, initial, 'h-10 w-10') : <UserCircle className="h-8 w-8 text-comet" />}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                  {user?.username}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                <span className="mt-2 inline-flex rounded-full border border-comet/25 bg-comet/10 px-2 py-0.5 text-[11px] font-semibold text-comet">
                  {providerLabel}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.08]"
            onClick={() => {
              setOpen(false)
              onSettings()
            }}
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-500/10"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
