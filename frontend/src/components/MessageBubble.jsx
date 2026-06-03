import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Check, Copy, ExternalLink, FileText, Timer, UserCircle } from 'lucide-react'

function hasHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

function toClipboardText(content) {
  if (!hasHtml(content)) return content

  const element = document.createElement('div')
  element.innerHTML = content
  return element.innerText
}

function MarkdownContent({ content }) {
  if (hasHtml(content)) {
    return (
      <div
        className="markdown-body select-text"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  return (
    <div className="markdown-body select-text">
      <ReactMarkdown
        components={{
          pre({ children }) {
            return (
              <pre className="my-3 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-slate-100 dark:bg-black/40">
                {children}
              </pre>
            )
          },
          code({ className, children, ...props }) {
            return (
              <code className={`${className || ''} select-text`} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function formatAuthors(authors = []) {
  if (!Array.isArray(authors) || authors.length === 0) return 'Unknown authors'
  if (authors.length <= 4) return authors.join(', ')
  return `${authors.slice(0, 4).join(', ')} et al.`
}

function formatNumber(value) {
  if (typeof value !== 'number') return '0'
  return new Intl.NumberFormat().format(value)
}

function ResearchRagPanel({ metadata }) {
  if (!metadata || metadata.mode !== 'research_rag') return null

  const citations = Array.isArray(metadata.citations) ? metadata.citations : []
  const papersRetrieved = Number(metadata.papers_retrieved || 0)
  const papersUsed = Number(metadata.papers_used || 0)
  const contextLength = Number(metadata.context_length || 0)
  const responseTime = Number(metadata.response_time_ms || 0)

  return (
    <section className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Papers Retrieved
          </p>
          <p className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
            {formatNumber(papersRetrieved)}
            {papersUsed ? <span className="text-xs font-medium text-slate-500"> / {papersUsed} used</span> : null}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Context Length
          </p>
          <p className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
            {formatNumber(contextLength)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="flex items-center gap-1 font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            <Timer className="h-3.5 w-3.5" />
            Response Time
          </p>
          <p className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
            {formatNumber(responseTime)} ms
          </p>
        </div>
      </div>

      {citations.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            <FileText className="h-4 w-4" />
            Paper Citations
          </h3>
          <div className="space-y-2">
            {citations.map((citation, index) => (
              <article
                key={`${citation.ads_url || citation.title}-${index}`}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs leading-5 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <h4 className="text-sm font-semibold leading-5 text-slate-950 dark:text-white">
                  {citation.title || 'Untitled paper'}
                </h4>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {formatAuthors(citation.authors)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
                  <span>Year: {citation.year || 'Unknown'}</span>
                  <span>DOI: {citation.doi || 'Not listed'}</span>
                  {citation.ads_url && (
                    <a
                      className="inline-flex items-center gap-1 font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 dark:text-comet"
                      href={citation.ads_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ADS Link
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  async function copyMessage() {
    await navigator.clipboard.writeText(toClipboardText(message.content))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <article className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-comet/25 to-aurora/20 text-sky-700 ring-1 ring-slate-200 dark:text-comet dark:ring-white/10">
          <Bot className="h-5 w-5" />
        </div>
      )}

      <div
        className={`group relative max-w-[min(760px,88%)] select-text rounded-3xl px-4 py-3 pr-12 text-sm leading-7 shadow-lg transition ${
          isUser
            ? 'bg-gradient-to-br from-comet to-aurora text-slate-950'
            : 'border border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100'
        } ${message.failed ? 'ring-2 ring-red-400/70' : ''}`}
      >
        <button
          type="button"
          className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-xl transition ${
            isUser
              ? 'bg-slate-950/10 text-slate-900 hover:bg-slate-950/20'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 dark:hover:text-white'
          }`}
          onClick={copyMessage}
          aria-label={isUser ? 'Copy prompt' : 'Copy response'}
          title={isUser ? 'Copy prompt' : 'Copy response'}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>

        <MarkdownContent content={message.content} />
        {!isUser && <ResearchRagPanel metadata={message.rag_metadata} />}

        {message.failed && (
          <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-200">
            Message was not sent. Use Retry above.
          </p>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-white/10">
          <UserCircle className="h-5 w-5" />
        </div>
      )}
    </article>
  )
}
