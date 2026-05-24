import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, Moon, Search, Settings, Sun } from 'lucide-react'
import ProfileDropdown from '../components/ProfileDropdown'
import SettingsModal from '../components/SettingsModal'
import Sidebar from '../components/Sidebar'
import { useTheme } from '../hooks/useTheme'

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyState, setHistoryState] = useState({
    history: [],
    loading: true,
    activeChatId: null,
    selectChat: () => {},
    newChat: () => {},
  })
  const { theme, toggleTheme } = useTheme()

  return (
    <main className="flex min-h-screen bg-space-radial text-white light:bg-slate-100 light:text-slate-950">
      <Sidebar
        history={historyState.history}
        loading={historyState.loading}
        activeChatId={historyState.activeChatId}
        onSelectChat={(item) => {
          historyState.selectChat(item)
          setSidebarOpen(false)
        }}
        onNewChat={() => {
          historyState.newChat()
          setSidebarOpen(false)
        }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-void/75 px-4 py-3 backdrop-blur-2xl light:border-slate-200 light:bg-white/80 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="icon-button lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="hidden h-10 min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm text-slate-400 light:border-slate-200 light:bg-white md:flex">
                <Search className="h-4 w-4" />
                <span className="truncate">Search history from the sidebar</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Toggle theme">
                {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </button>
              <button
                className="icon-button hidden sm:inline-flex"
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open settings"
              >
                <Settings className="h-5 w-5" />
              </button>
              <ProfileDropdown onSettings={() => setSettingsOpen(true)} />
            </div>
          </div>
        </header>

        <Outlet context={{ setHistoryState }} />
      </section>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  )
}
