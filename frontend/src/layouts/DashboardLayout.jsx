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
    activeTitle: 'New chat',
    selectChat: () => {},
    newChat: () => {},
    renameChat: () => {},
    deleteChat: () => {},
    clearChats: () => {},
  })
  const { theme, toggleTheme } = useTheme()

  return (
    <main className="flex h-screen overflow-hidden bg-slate-100 text-slate-950 dark:bg-space-radial dark:text-white">
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
        onRenameChat={historyState.renameChat}
        onDeleteChat={historyState.deleteChat}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-2xl dark:border-white/10 dark:bg-void/75 sm:px-6">
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
              <div className="hidden h-10 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400 md:flex">
                <Search className="h-4 w-4" />
                <span className="truncate">{historyState.activeTitle || 'Search history from the sidebar'}</span>
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onClearConversations={historyState.clearChats}
        conversationCount={historyState.history.length}
      />
    </main>
  )
}
