import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AlertCircle, Bot, Copy, Send, Sparkles } from 'lucide-react'
import MessageBubble from '../components/MessageBubble'
import PageTransition from '../components/PageTransition'
import TypingIndicator from '../components/TypingIndicator'
import { ChatSkeleton } from '../components/Skeletons'
import { askQuestion, getApiError, getChatHistory } from '../services/api'
import { useAuth } from '../hooks/useAuth'

function createSessionId() {
  const next = `web_${Date.now()}_${Math.random().toString(16).slice(2)}`
  sessionStorage.setItem('nasa_agent_session_id', next)
  return next
}

function getSessionId() {
  return sessionStorage.getItem('nasa_agent_session_id') || createSessionId()
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function historyToMessages(item) {
  return [
    { id: `${item.id}-q`, role: 'user', content: item.question },
    { id: `${item.id}-a`, role: 'assistant', content: item.answer },
  ]
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { setHistoryState } = useOutletContext()
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [activeChatId, setActiveChatId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState(getSessionId)
  const scrollRef = useRef(null)

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await getChatHistory()
      setHistory(data)
    } catch (err) {
      setError(getApiError(err, 'Could not load chat history.'))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, submitting])

  const selectChat = useCallback((item) => {
    setActiveChatId(item.id)
    setMessages(historyToMessages(item))
  }, [])

  const newChat = useCallback(() => {
    const next = createSessionId()
    setSessionId(next)
    setActiveChatId(null)
    setMessages([])
    setQuestion('')
    setError('')
  }, [])

  useEffect(() => {
    setHistoryState({
      history,
      loading: historyLoading,
      activeChatId,
      selectChat,
      newChat,
    })
  }, [activeChatId, history, historyLoading, newChat, selectChat, setHistoryState])

  async function handleSubmit(event) {
    event.preventDefault()

    const prompt = question.trim()
    if (!prompt || submitting) return

    setQuestion('')
    setError('')
    setActiveChatId(null)
    setMessages((current) => [
      ...current,
      { id: makeId(), role: 'user', content: prompt },
    ])
    setSubmitting(true)

    try {
      const data = await askQuestion(prompt, sessionId)
      setMessages((current) => [
        ...current,
        { id: makeId(), role: 'assistant', content: data.answer },
      ])
      await refreshHistory()
    } catch (err) {
      setError(getApiError(err, 'The AI agent could not answer right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyLastAnswer() {
    const lastAnswer = [...messages].reverse().find((message) => message.role === 'assistant')
    if (lastAnswer) {
      await navigator.clipboard.writeText(lastAnswer.content)
    }
  }

  return (
    <PageTransition className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <section className="mb-6 rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 shadow-glow backdrop-blur-xl light:border-slate-200 light:bg-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-comet">
                <Sparkles className="h-4 w-4" />
                Mission console
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-white light:text-slate-950 sm:text-3xl">
                Welcome back, {user?.username}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 light:text-slate-600">
                Ask about space biology, microgravity, lunar missions, radiation biology, and NASA research.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={copyLastAnswer}
              disabled={!messages.some((message) => message.role === 'assistant')}
            >
              <Copy className="h-4 w-4" />
              Copy answer
            </button>
          </div>
        </section>

        {error && (
          <div className="mb-4 flex gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100 light:text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto rounded-[2rem] border border-white/10 bg-slate-950/30 p-4 backdrop-blur-xl light:border-slate-200 light:bg-white/70 sm:p-6">
          {historyLoading && messages.length === 0 ? (
            <ChatSkeleton />
          ) : messages.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-comet/25 to-solar/20 text-comet ring-1 ring-white/10">
                <Bot className="h-8 w-8" />
              </div>
              <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white light:text-slate-950">
                What are we investigating today?
              </h2>
              <div className="mt-6 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                {[
                  'Summarize NASA research on plants in microgravity',
                  'Find papers about radiation exposure and astronauts',
                  'Explain lunar habitat biology risks',
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left text-sm text-slate-300 transition hover:border-comet/40 hover:bg-comet/10 light:border-slate-200 light:bg-white light:text-slate-700"
                    onClick={() => setQuestion(sample)}
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
                <div className="glass-panel inline-flex rounded-2xl px-4 py-2">
                  <TypingIndicator />
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          )}
        </section>

        <form className="mt-4 flex items-end gap-3" onSubmit={handleSubmit}>
          <textarea
            className="field max-h-40 min-h-14 resize-none rounded-3xl py-4"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask the NASA Space Biology AI Agent..."
            rows={1}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSubmit(event)
              }
            }}
          />
          <button className="primary-button h-14 w-14 shrink-0 rounded-3xl p-0" type="submit" disabled={submitting || !question.trim()} aria-label="Send question">
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </PageTransition>
  )
}
