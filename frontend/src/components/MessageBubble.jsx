import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Check, Copy, UserCircle } from 'lucide-react'

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
