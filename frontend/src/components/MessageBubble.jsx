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
  const queryExpansionUsed = Boolean(metadata.query_expansion_used)
  const expandedQueries = Array.isArray(metadata.expanded_queries) ? metadata.expanded_queries : []
  const researchMode = metadata.research_mode || 'Standard Research RAG'

  return (
    <section className="mt-5 border-t border-slate-200 pt-5 dark:border-white/10">
      {citations.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            <FileText className="h-4 w-4" />
            Sources ({citations.length})
          </h3>
          <div className="space-y-3">
            {citations.map((citation, index) => (
              <article
                key={`${citation.ads_url || citation.title}-${index}`}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-xs leading-5 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-comet/10 dark:text-comet dark:ring-comet/20">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base font-semibold leading-6 text-slate-950 dark:text-white">
                      {citation.title || 'Untitled paper'}
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {formatAuthors(citation.authors)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>{citation.year || 'Unknown year'}</span>
                      {typeof citation.citation_count === 'number' && (
                        <span>{formatNumber(citation.citation_count)} citations</span>
                      )}
                      {citation.doi && <span>DOI: {citation.doi}</span>}
                    </div>
                    {citation.ads_url && (
                      <a
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 dark:text-comet"
                        href={citation.ads_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ADS Link
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
          <Timer className="h-4 w-4" />
          Research Metrics
        </h3>
        <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]">
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">
              Papers Retrieved
            </p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(papersRetrieved)}
              {papersUsed ? <span className="font-medium text-slate-500"> / {papersUsed} used</span> : null}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]">
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">
              Context Length
            </p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(contextLength)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]">
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">
              Response Time
            </p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">
              {formatNumber(responseTime)} ms
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]">
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">
              Query Expansion Used
            </p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-200">
              {queryExpansionUsed ? 'Yes' : 'No'}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
          Mode: {researchMode}
        </p>
        {expandedQueries.length > 0 && (
          <div className="mt-2">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Expanded Queries:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
              {expandedQueries.map((query) => (
                <li key={query}>{query}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const isResearchResponse = !isUser && message.rag_metadata?.mode === 'research_rag'
  const [copied, setCopied] = useState(false)

  async function copyMessage() {
    await navigator.clipboard.writeText(toClipboardText(message.content))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <article className={`flex w-full gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-comet/25 to-aurora/20 text-sky-700 ring-1 ring-slate-200 dark:text-comet dark:ring-white/10">
          <Bot className="h-5 w-5" />
        </div>
      )}

      <div
        className={`group relative min-w-0 select-text rounded-3xl px-4 py-3 pr-12 text-sm leading-7 shadow-lg transition sm:px-5 sm:py-4 ${
          isUser ? 'max-w-[min(760px,88%)]' : 'w-full max-w-[1120px]'
        } ${
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

        {isResearchResponse && (
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Answer
          </h2>
        )}
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
