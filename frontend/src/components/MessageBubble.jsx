import ReactMarkdown from 'react-markdown'
import { Bot, UserCircle } from 'lucide-react'

function hasHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'

  return (
    <article className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-comet/25 to-aurora/20 text-comet ring-1 ring-white/10">
          <Bot className="h-5 w-5" />
        </div>
      )}

      <div
        className={`max-w-[min(760px,88%)] rounded-3xl px-4 py-3 text-sm leading-7 shadow-lg ${
          isUser
            ? 'bg-gradient-to-br from-comet to-aurora text-slate-950'
            : 'glass-panel text-slate-100 light:text-slate-900'
        }`}
      >
        {hasHtml(message.content) ? (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: message.content }}
          />
        ) : (
          <div className="markdown-body">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/10 light:bg-slate-100 light:text-slate-700">
          <UserCircle className="h-5 w-5" />
        </div>
      )}
    </article>
  )
}
