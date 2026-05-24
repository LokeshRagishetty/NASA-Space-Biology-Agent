import { History, MessageSquare, Plus, Satellite, X } from 'lucide-react'
import { HistorySkeleton } from './Skeletons'

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

export default function Sidebar({
  history,
  loading,
  activeChatId,
  onSelectChat,
  onNewChat,
  open,
  onClose,
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[316px] max-w-[86vw] flex-col border-r border-white/10 bg-void/95 p-4 transition-transform duration-300 light:border-slate-200 light:bg-slate-50 lg:static lg:z-auto lg:max-w-none lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-comet/25 to-solar/20 text-comet ring-1 ring-white/10">
              <Satellite className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white light:text-slate-950">NASA Bio Agent</p>
              <p className="text-xs text-slate-500">Research workspace</p>
            </div>
          </div>
          <button className="icon-button lg:hidden" type="button" onClick={onClose} aria-label="Close sidebar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button type="button" className="primary-button mb-5 w-full" onClick={onNewChat}>
          <Plus className="h-4 w-4" />
          New chat
        </button>

        <div className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          <History className="h-4 w-4" />
          History
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <HistorySkeleton />
          ) : history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500 light:border-slate-200">
              No chats yet.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectChat(item)}
                  className={`group flex w-full gap-3 rounded-2xl border p-3 text-left transition ${
                    activeChatId === item.id
                      ? 'border-comet/40 bg-comet/10'
                      : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] light:border-slate-200 light:bg-white'
                  }`}
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-comet" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-medium text-slate-200 light:text-slate-800">
                      {item.question}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{formatDate(item.timestamp)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
