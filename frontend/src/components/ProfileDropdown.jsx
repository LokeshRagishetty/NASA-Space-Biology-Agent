import { useState } from 'react'
import { ChevronDown, LogOut, Settings, UserCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export default function ProfileDropdown({ onSettings }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const initial = user?.username?.slice(0, 1)?.toUpperCase() || 'A'

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 transition hover:bg-white/[0.10] light:border-slate-200 light:bg-white"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-comet to-solar text-sm font-bold text-slate-950">
          {initial}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block truncate text-sm font-semibold text-white light:text-slate-950">
            {user?.username}
          </span>
          <span className="block truncate text-xs text-slate-400 light:text-slate-500">
            {user?.email}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <div className="glass-panel absolute right-0 mt-3 w-64 rounded-2xl p-2">
          <div className="border-b border-white/10 px-3 py-3 light:border-slate-200">
            <div className="flex items-center gap-3">
              <UserCircle className="h-8 w-8 text-comet" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white light:text-slate-950">
                  {user?.username}
                </p>
                <p className="truncate text-xs text-slate-400 light:text-slate-500">{user?.email}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.08] light:text-slate-700 light:hover:bg-slate-100"
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
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-200 transition hover:bg-red-500/10 light:text-red-600"
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
