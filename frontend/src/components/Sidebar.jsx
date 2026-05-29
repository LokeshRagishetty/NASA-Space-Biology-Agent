import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Check,
  History,
  Library,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Satellite,
  Trash2,
  X,
} from 'lucide-react'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
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

function stripHtml(value = '') {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightText({ text, query }) {
  if (!query) return text

  const pattern = new RegExp(`(${escapeRegExp(query)})`, 'ig')
  return String(text)
    .split(pattern)
    .map((part, index) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={`${part}-${index}`} className="rounded bg-comet/25 px-0.5 text-inherit">
          {part}
        </mark>
      ) : (
        part
      ),
    )
}

function getPreview(conversation) {
  const lastMessage = [...(conversation.messages || [])].reverse().find((message) => message.content)
  return stripHtml(lastMessage?.content || 'No messages yet.')
}

export default function Sidebar({
  history,
  loading,
  activeChatId,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  open,
  onClose,
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [draftTitle, setDraftTitle] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 220)
  const libraryActive = location.pathname.startsWith('/app/library')

  const filteredHistory = useMemo(() => {
    if (!debouncedSearch) return history

    const query = debouncedSearch.toLowerCase()
    return history.filter((conversation) => {
      const titleMatch = conversation.title?.toLowerCase().includes(query)
      const messageMatch = conversation.messages?.some((message) =>
        stripHtml(message.content).toLowerCase().includes(query),
      )
      return titleMatch || messageMatch
    })
  }, [debouncedSearch, history])

  async function submitRename(event, conversation) {
    event.preventDefault()
    event.stopPropagation()

    const title = draftTitle.trim()
    if (title && title !== conversation.title) {
      await onRenameChat(conversation.id, title)
    }

    setRenamingId(null)
    setDraftTitle('')
  }

  async function requestDelete(event, conversation) {
    event.stopPropagation()
    const confirmed = window.confirm(`Delete "${conversation.title}"?`)
    if (confirmed) {
      await onDeleteChat(conversation.id)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[316px] max-w-[86vw] flex-col border-r border-slate-200 bg-slate-50 p-4 shadow-2xl transition-transform duration-300 dark:border-white/10 dark:bg-void/95 lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            className="flex min-w-0 items-center gap-3 rounded-2xl p-1 text-left transition hover:bg-slate-200/70 dark:hover:bg-white/[0.06]"
            onClick={() => {
              navigate('/app')
              onClose?.()
            }}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-comet/25 to-solar/20 text-sky-700 ring-1 ring-slate-200 dark:text-comet dark:ring-white/10">
              <Satellite className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-950 dark:text-white">
                NASA Bio Agent
              </span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-500">
                Research workspace
              </span>
            </span>
          </button>
          <button className="icon-button lg:hidden" type="button" onClick={onClose} aria-label="Close sidebar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button type="button" className="primary-button mb-4 w-full" onClick={onNewChat}>
          <Plus className="h-4 w-4" />
          New chat
        </button>

        <button
          type="button"
          className={`mb-4 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition ${
            libraryActive
              ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-comet/40 dark:bg-comet/10 dark:text-comet'
              : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]'
          }`}
          onClick={() => {
            navigate('/app/library')
            onClose?.()
          }}
        >
          <Library className="h-4 w-4" />
          Knowledge Library
        </button>

        <label className="relative mb-4 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="field h-11 rounded-2xl pl-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </label>

        <div className="mb-3 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          <History className="h-4 w-4" />
          History
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <HistorySkeleton />
          ) : history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/10">
              No conversations yet.
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/10">
              No conversations match "{debouncedSearch}".
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((item) => {
                const active = activeChatId === item.id
                const preview = getPreview(item)

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(item)}
                    onKeyDown={(event) => {
                      if (renamingId === item.id) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectChat(item)
                      }
                    }}
                    className={`group relative flex w-full gap-3 rounded-2xl border p-3 text-left transition duration-200 ${
                      active
                        ? 'border-sky-300 bg-sky-50 shadow-sm dark:border-comet/40 dark:bg-comet/10'
                        : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/70 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-3 h-8 w-1 rounded-r-full transition ${
                        active ? 'bg-comet opacity-100' : 'bg-transparent opacity-0'
                      }`}
                    />
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-comet" />
                    <span className="min-w-0 flex-1">
                      {renamingId === item.id ? (
                        <form
                          className="flex gap-2"
                          onClick={(event) => event.stopPropagation()}
                          onSubmit={(event) => submitRename(event, item)}
                        >
                          <input
                            className="field h-8 rounded-xl px-2 py-1"
                            value={draftTitle}
                            autoFocus
                            onChange={(event) => setDraftTitle(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.stopPropagation()
                                setRenamingId(null)
                                setDraftTitle('')
                              }
                            }}
                          />
                          <button className="icon-button h-8 w-8 rounded-xl" type="submit" aria-label="Save title">
                            <Check className="h-4 w-4" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="line-clamp-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                            <HighlightText text={item.title || 'New chat'} query={debouncedSearch} />
                          </span>
                          <span className="mt-1 line-clamp-1 text-xs text-slate-500">
                            <HighlightText text={preview} query={debouncedSearch} />
                          </span>
                          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                            {formatDate(item.updated_at)}
                          </span>
                        </>
                      )}
                    </span>

                    {renamingId !== item.id && (
                      <span className="flex shrink-0 items-start gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                          aria-label="Rename conversation"
                          onClick={(event) => {
                            event.stopPropagation()
                            setRenamingId(item.id)
                            setDraftTitle(item.title || 'New chat')
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                          aria-label="Delete conversation"
                          onClick={(event) => requestDelete(event, item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
