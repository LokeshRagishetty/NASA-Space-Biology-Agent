import { motion } from 'framer-motion'
import { Moon, Sun, X } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

export default function SettingsModal({ open, onClose }) {
  const { theme, toggleTheme } = useTheme()

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <motion.section
        className="glass-panel w-full max-w-md rounded-3xl p-5"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white light:text-slate-950">Settings</h2>
            <p className="text-sm text-slate-400 light:text-slate-500">Workspace preferences</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left transition hover:bg-white/[0.09] light:border-slate-200 light:bg-white"
          onClick={toggleTheme}
        >
          <span>
            <span className="block font-medium text-white light:text-slate-950">Appearance</span>
            <span className="text-sm text-slate-400 light:text-slate-500">
              Current mode: {theme}
            </span>
          </span>
          {theme === 'dark' ? <Moon className="h-5 w-5 text-comet" /> : <Sun className="h-5 w-5 text-solar" />}
        </button>
      </motion.section>
    </div>
  )
}
