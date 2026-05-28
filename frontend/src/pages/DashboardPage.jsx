import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AlertCircle, Bot, RefreshCw, Send, Sparkles } from 'lucide-react'
import MessageBubble from '../components/MessageBubble'
import PageTransition from '../components/PageTransition'
import TypingIndicator from '../components/TypingIndicator'
import { ChatSkeleton } from '../components/Skeletons'
import { useAutoResizeTextarea } from '../hooks/useAutoResizeTextarea'
import {
  clearConversations,
  createConversation,
  deleteConversation,
  getApiError,
  getConversation,
  getConversations,
  renameConversation,
  sendConversationMessage,
} from '../services/api'
import { useAuth } from '../hooks/useAuth'

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeConversation(conversation) {
  return {
    ...conversation,
    messages: conversation.messages || [],
  }
}

function sortConversations(conversations) {
  return [...conversations].sort(
    (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at),
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { setHistoryState } = useOutletContext()
  const [conversations, setConversations] = useState([])
  const [conversationLoading, setConversationLoading] = useState(true)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [error, setError] = useState('')
  const [retryPrompt, setRetryPrompt] = useState('')
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const activeConversationKey = useMemo(
    () => `nasa_agent_active_conversation_id_${user?.id || 'guest'}`,
    [user?.id],
  )
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  )

  useAutoResizeTextarea(textareaRef, question)

  const replaceConversation = useCallback((conversation, { promote = false } = {}) => {
    const normalized = normalizeConversation(conversation)
    setConversations((current) => {
      const rest = current.filter((item) => item.id !== normalized.id)
      if (promote) {
        return [normalized, ...rest]
      }
      const next = current.some((item) => item.id === normalized.id)
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [normalized, ...current]
      return sortConversations(next)
    })
  }, [])

  const focusComposer = useCallback(() => {
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const loadConversations = useCallback(async () => {
    setConversationLoading(true)
    setError('')

    try {
      const data = await getConversations()
      const normalized = sortConversations(data.map(normalizeConversation))
      const savedId = Number(localStorage.getItem(activeConversationKey))
      const savedConversation = normalized.find((conversation) => conversation.id === savedId)

      setConversations(normalized)
      if (savedConversation) {
        setActiveConversationId(savedConversation.id)
        setMessages(savedConversation.messages)
      } else {
        setActiveConversationId(null)
        setMessages([])
      }
    } catch (err) {
      setError(getApiError(err, 'Could not load conversations.'))
    } finally {
      setConversationLoading(false)
      focusComposer()
    }
  }, [activeConversationKey, focusComposer])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, submitting])

  const selectChat = useCallback(
    async (conversation) => {
      setActiveConversationId(conversation.id)
      localStorage.setItem(activeConversationKey, String(conversation.id))
      setMessages(conversation.messages || [])
      setError('')
      setRetryPrompt('')
      setMessageLoading(true)

      try {
        const freshConversation = normalizeConversation(await getConversation(conversation.id))
        replaceConversation(freshConversation)
        setMessages(freshConversation.messages)
      } catch (err) {
        setError(getApiError(err, 'Could not load this conversation.'))
      } finally {
        setMessageLoading(false)
        focusComposer()
      }
    },
    [activeConversationKey, focusComposer, replaceConversation],
  )

  const newChat = useCallback(async () => {
    const emptyActiveChat =
      activeConversation &&
      activeConversation.title === 'New chat' &&
      (activeConversation.messages || []).length === 0

    if (emptyActiveChat) {
      setMessages([])
      setQuestion('')
      setError('')
      focusComposer()
      return
    }

    setCreatingChat(true)
    setError('')
    setRetryPrompt('')

    try {
      const conversation = normalizeConversation(await createConversation())
      replaceConversation(conversation, { promote: true })
      setActiveConversationId(conversation.id)
      localStorage.setItem(activeConversationKey, String(conversation.id))
      setMessages([])
      setQuestion('')
      focusComposer()
    } catch (err) {
      setError(getApiError(err, 'Could not create a new chat.'))
    } finally {
      setCreatingChat(false)
    }
  }, [activeConversation, activeConversationKey, focusComposer, replaceConversation])

  const renameChat = useCallback(
    async (conversationId, title) => {
      try {
        const updatedConversation = normalizeConversation(await renameConversation(conversationId, title))
        replaceConversation(updatedConversation)
        if (conversationId === activeConversationId) {
          setMessages(updatedConversation.messages)
        }
      } catch (err) {
        setError(getApiError(err, 'Could not rename this conversation.'))
      }
    },
    [activeConversationId, replaceConversation],
  )

  const deleteChat = useCallback(
    async (conversationId) => {
      try {
        await deleteConversation(conversationId)
        setConversations((current) => current.filter((conversation) => conversation.id !== conversationId))
        if (conversationId === activeConversationId) {
          setActiveConversationId(null)
          setMessages([])
          localStorage.removeItem(activeConversationKey)
        }
      } catch (err) {
        setError(getApiError(err, 'Could not delete this conversation.'))
      } finally {
        focusComposer()
      }
    },
    [activeConversationId, activeConversationKey, focusComposer],
  )

  const clearChats = useCallback(async () => {
    try {
      await clearConversations()
      setConversations([])
      setActiveConversationId(null)
      setMessages([])
      setQuestion('')
      setError('')
      setRetryPrompt('')
      localStorage.removeItem(activeConversationKey)
    } catch (err) {
      setError(getApiError(err, 'Could not clear conversations.'))
    } finally {
      focusComposer()
    }
  }, [activeConversationKey, focusComposer])

  useEffect(() => {
    setHistoryState({
      history: conversations,
      loading: conversationLoading,
      activeChatId: activeConversationId,
      activeTitle: activeConversation?.title || 'New chat',
      selectChat,
      newChat,
      renameChat,
      deleteChat,
      clearChats,
    })
  }, [
    activeConversation,
    activeConversationId,
    clearChats,
    conversationLoading,
    conversations,
    deleteChat,
    newChat,
    renameChat,
    selectChat,
    setHistoryState,
  ])

  async function ensureActiveConversation() {
    if (activeConversationId) {
      return activeConversationId
    }

    const conversation = normalizeConversation(await createConversation())
    replaceConversation(conversation, { promote: true })
    setActiveConversationId(conversation.id)
    localStorage.setItem(activeConversationKey, String(conversation.id))
    return conversation.id
  }

  async function submitPrompt(prompt, { removeFailed = false } = {}) {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || submitting) return

    if (removeFailed) {
      setMessages((current) => current.filter((message) => !message.failed))
    }

    const optimisticId = `pending-${makeId()}`
    setQuestion('')
    setError('')
    setRetryPrompt('')
    setSubmitting(true)

    try {
      const conversationId = await ensureActiveConversation()
      setMessages((current) => [
        ...current,
        {
          id: optimisticId,
          conversation_id: conversationId,
          role: 'user',
          content: trimmedPrompt,
          created_at: new Date().toISOString(),
        },
      ])

      const data = await sendConversationMessage(conversationId, trimmedPrompt)
      const updatedConversation = normalizeConversation(data.conversation)
      replaceConversation(updatedConversation, { promote: true })
      setActiveConversationId(updatedConversation.id)
      localStorage.setItem(activeConversationKey, String(updatedConversation.id))
      setMessages(updatedConversation.messages)
    } catch (err) {
      setError(getApiError(err, 'Failed message send. Please retry.'))
      setRetryPrompt(trimmedPrompt)
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticId ? { ...message, failed: true } : message,
        ),
      )
    } finally {
      setSubmitting(false)
      focusComposer()
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    submitPrompt(question)
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

    event.preventDefault()
    if (question.trim()) {
      submitPrompt(question)
    }
  }

  const samplePrompts = [
    'Summarize NASA research on plants in microgravity',
    'Find papers about radiation exposure and astronauts',
    'Explain lunar habitat biology risks',
  ]

  return (
    <PageTransition className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
        <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition dark:border-white/10 dark:bg-white/[0.05] dark:shadow-glow dark:backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-comet">
                <Sparkles className="h-4 w-4" />
                Mission console
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {activeConversation?.title || `Welcome back, ${user?.username}`}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Ask about space biology, microgravity, lunar missions, radiation biology, and NASA research.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={newChat}
              disabled={creatingChat}
            >
              <RefreshCw className={`h-4 w-4 ${creatingChat ? 'animate-spin' : ''}`} />
              New chat
            </button>
          </div>
        </section>

        {error && (
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </span>
            {retryPrompt && (
              <button
                type="button"
                className="secondary-button py-2"
                onClick={() => submitPrompt(retryPrompt, { removeFailed: true })}
                disabled={submitting}
              >
                <RefreshCw className={`h-4 w-4 ${submitting ? 'animate-spin' : ''}`} />
                Retry
              </button>
            )}
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm transition dark:border-white/10 dark:bg-slate-950/30 dark:backdrop-blur-xl sm:p-6">
          {(conversationLoading || messageLoading) && messages.length === 0 ? (
            <ChatSkeleton />
          ) : messages.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-comet/25 to-solar/20 text-sky-700 ring-1 ring-slate-200 dark:text-comet dark:ring-white/10">
                <Bot className="h-8 w-8" />
              </div>
              <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                What are we investigating today?
              </h2>
              <div className="mt-6 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                {samplePrompts.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:border-comet/40 dark:hover:bg-comet/10"
                    onClick={() => {
                      setQuestion(sample)
                      focusComposer()
                    }}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {submitting && (
                <div className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
                  <TypingIndicator />
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          )}
        </section>

        <form className="mt-4 flex items-end gap-3" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className="field max-h-44 min-h-14 resize-none rounded-3xl py-4 leading-6"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask the NASA Space Biology AI Agent..."
            rows={1}
            onKeyDown={handleComposerKeyDown}
          />
          <button
            className="primary-button h-14 w-14 shrink-0 rounded-3xl p-0"
            type="submit"
            disabled={submitting || !question.trim()}
            aria-label="Send question"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </PageTransition>
  )
}
