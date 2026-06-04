import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Cpu,
  Database,
  Download,
  FileSearch,
  FileImage,
  FileText,
  Layers,
  Library,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import PageTransition from '../components/PageTransition'
import { useAuth } from '../hooks/useAuth'
import {
  askLibraryQuestion,
  deleteLibraryConversation,
  deleteKnowledgeDocument,
  getApiError,
  getKnowledgeDocumentChunks,
  getKnowledgeDocumentChunkStats,
  getKnowledgeDocumentEmbeddingStats,
  getKnowledgeDocumentText,
  getKnowledgeDocumentPreview,
  getKnowledgeDocumentVectorStats,
  getKnowledgeDocuments,
  getLibraryConversation,
  getLibraryConversations,
  getVectorStoreHealth,
  getVectorStoreStats,
  regenerateKnowledgeDocumentEmbeddings,
  renameLibraryConversation,
  reprocessKnowledgeDocument,
  syncKnowledgeDocumentVectors,
  uploadKnowledgeDocument,
} from '../services/api'

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg'])
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const ACTIVE_PROCESSING_STATUSES = new Set(['pending', 'processing'])
const EMPTY_CHUNKS = []

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat().format(value)
}

function formatShortDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function formatPageCount(value) {
  const count = Number.isFinite(value) ? value : 0
  return `${formatNumber(count)} Page${count === 1 ? '' : 's'}`
}

function formatDocumentType(document) {
  if (!document) return ''
  if (document.content_type === 'application/pdf' || document.type === 'application/pdf') return 'PDF'
  const extension = document.file_extension || document.type?.split('/').pop() || ''
  return extension ? extension.toUpperCase() : 'Document'
}

function getDocumentStatus(document) {
  return document?.processing_status || document?.status || 'pending'
}

function getEmbeddingStatus(document, embeddingStats) {
  const status = getDocumentStatus(document)
  if (ACTIVE_PROCESSING_STATUSES.has(status)) return 'Generating'
  if (status === 'failed') return 'Unavailable'

  const chunkCount = embeddingStats?.chunk_count || 0
  const embeddingCount = embeddingStats?.embedding_count || 0

  if (!chunkCount) return 'No chunks'
  if (embeddingCount === chunkCount) return 'Ready'
  if (!embeddingCount) return 'Missing'
  return 'Partial'
}

function getVectorStatus(document, embeddingStats, vectorStats, vectorHealth) {
  const status = getDocumentStatus(document)
  if (vectorHealth?.status && vectorHealth.status !== 'healthy') return 'Unavailable'
  if (ACTIVE_PROCESSING_STATUSES.has(status)) return 'Syncing'
  if (status === 'failed') return 'Unavailable'

  const embeddingCount = embeddingStats?.embedding_count || 0
  const storedVectors = vectorStats?.stored_vectors || 0

  if (!embeddingCount) return 'No embeddings'
  if (storedVectors === embeddingCount) return 'Ready'
  if (!storedVectors) return 'Missing'
  return 'Partial'
}

function buildHighlightedSegments(text, query) {
  const search = query.trim()
  if (!search || !text) {
    return { count: 0, segments: [{ text, match: false }] }
  }

  const segments = []
  const lowerText = text.toLowerCase()
  const lowerSearch = search.toLowerCase()
  let cursor = 0
  let count = 0

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerSearch, cursor)
    if (index === -1) break
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false })
    }
    segments.push({ text: text.slice(index, index + search.length), match: true })
    count += 1
    cursor = index + search.length
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }

  return { count, segments }
}

function normalizeLibraryConversation(conversation) {
  return {
    ...conversation,
    selected_document_id: conversation.selected_document_id ?? conversation.document_id ?? null,
    messages: conversation.messages || [],
  }
}

function sortLibraryConversations(conversations) {
  return [...conversations].sort(
    (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at),
  )
}

function getLastAssistantResult(messages = []) {
  const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  if (!assistantMessage) return null

  return {
    answer: assistantMessage.content,
    citations: assistantMessage.citations || assistantMessage.citations_json || [],
  }
}

function DocumentIcon({ document }) {
  const isPdf = document.content_type === 'application/pdf'
  const Icon = isPdf ? FileText : FileImage
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-comet/10 dark:text-comet dark:ring-comet/20">
      <Icon className="h-5 w-5" />
    </span>
  )
}

function ProcessingStatusBadge({ status }) {
  const normalizedStatus = status || 'pending'
  const badgeConfig = {
    pending: {
      label: 'Processing',
      className:
        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100',
      active: true,
    },
    processing: {
      label: 'Processing',
      className:
        'border-sky-200 bg-sky-50 text-sky-700 dark:border-comet/25 dark:bg-comet/10 dark:text-comet',
      active: true,
    },
    completed: {
      label: 'Ready',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100',
      active: false,
    },
    failed: {
      label: 'Failed',
      className:
        'border-red-200 bg-red-50 text-red-700 dark:border-red-300/25 dark:bg-red-400/10 dark:text-red-100',
      active: false,
    },
  }
  const config = badgeConfig[normalizedStatus] || badgeConfig.pending

  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold ${config.className}`}
    >
      {config.active && <Loader2 className="h-3 w-3 animate-spin" />}
      {config.label}
    </span>
  )
}

function ExtractedTextModal({
  document,
  error,
  loading,
  onClose,
  onQueryChange,
  query,
  textPayload,
}) {
  const text = textPayload?.text || ''
  const status = textPayload?.status || getDocumentStatus(document)
  const extractionError = textPayload?.extraction_error || document?.extraction_error || ''
  const { count, segments } = useMemo(() => buildHighlightedSegments(text, query), [query, text])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-white/10 sm:p-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <ProcessingStatusBadge status={status} />
              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:border-white/10 dark:text-slate-300">
                {formatDocumentType(textPayload || document)}
              </span>
            </div>
            <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white sm:text-lg">
              {textPayload?.filename || document?.original_filename}
            </h2>
          </div>

          <button type="button" className="icon-button shrink-0" onClick={onClose} aria-label="Close extracted text">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4 dark:border-white/10 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="field rounded-xl py-2 pl-9"
                type="search"
                placeholder="Search extracted text"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                disabled={!text}
              />
            </label>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {query.trim() ? `${count} match${count === 1 ? '' : 'es'}` : 'Document text'}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100 sm:mx-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-[360px] overflow-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading extracted text
            </div>
          ) : ACTIVE_PROCESSING_STATUSES.has(status) ? (
            <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extraction is processing.
            </div>
          ) : status === 'failed' ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
              {extractionError || 'Extraction failed. Open Advanced Information to process the document again.'}
            </div>
          ) : text ? (
            <pre className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100">
              {segments.map((segment, index) =>
                segment.match ? (
                  <mark key={index} className="rounded bg-amber-200 px-0.5 text-slate-950">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </pre>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
              No extracted text was found in this file.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DocumentAnalyticsCard({
  document,
  embeddingError,
  embeddingLoading,
  embeddingStats,
  loading,
  onRegenerateEmbeddings,
  onReprocess,
  onSyncVectors,
  regeneratingEmbeddings,
  reprocessing,
  stats,
  syncingVectors,
  vectorError,
  vectorHealth,
  vectorLoading,
  vectorStats,
  vectorStoreStats,
}) {
  const status = getDocumentStatus(document)
  const embeddingStatus = getEmbeddingStatus(document, embeddingStats)
  const embeddingStatusClass = {
    Ready:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100',
    Generating:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-comet/25 dark:bg-comet/10 dark:text-comet',
    Missing:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100',
    Partial:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100',
    Unavailable:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-300/25 dark:bg-red-400/10 dark:text-red-100',
    'No chunks':
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
  }
  const vectorStatus = getVectorStatus(document, embeddingStats, vectorStats, vectorHealth)
  const vectorStatusClass = {
    Ready:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100',
    Syncing:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-comet/25 dark:bg-comet/10 dark:text-comet',
    Missing:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100',
    Partial:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100',
    Unavailable:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-300/25 dark:bg-red-400/10 dark:text-red-100',
    'No embeddings':
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
  }
  const searchStatus =
    status === 'failed'
      ? 'Failed'
      : ACTIVE_PROCESSING_STATUSES.has(status) || embeddingLoading || vectorLoading
        ? 'Processing'
        : embeddingStatus === 'Ready' || vectorStatus === 'Ready'
          ? 'Ready'
          : 'Processing'
  const searchStatusClass = {
    Ready:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100',
    Processing:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-comet/25 dark:bg-comet/10 dark:text-comet',
    Failed:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-300/25 dark:bg-red-400/10 dark:text-red-100',
  }
  const summaryItems = [
    { label: 'Pages', value: formatNumber(stats?.page_count || 0) },
    { label: 'Indexed Sections', value: formatNumber(stats?.chunk_count || 0) },
    { label: 'Search Status', value: searchStatus, type: 'status' },
    { label: 'Uploaded Date', value: formatShortDate(document?.uploaded_at) || 'Unknown' },
  ]
  const embeddingItems = [
    { label: 'Embedding Status', value: embeddingStatus, type: 'status', className: embeddingStatusClass[embeddingStatus] },
    { label: 'Embedding Count', value: embeddingStats?.embedding_count || 0, type: 'number' },
    { label: 'Embedding Dimension', value: embeddingStats?.embedding_dimension || 0, type: 'number' },
    { label: 'Model Name', value: embeddingStats?.embedding_model || 'all-MiniLM-L6-v2', type: 'text' },
  ]
  const vectorItems = [
    { label: 'Vector Status', value: vectorStatus, type: 'status', className: vectorStatusClass[vectorStatus] },
    { label: 'Stored Vector Count', value: vectorStats?.stored_vectors || 0, type: 'number' },
    {
      label: 'Collection Name',
      value: vectorStoreStats?.collection_name || vectorHealth?.collection || 'knowledge_documents',
      type: 'text',
    },
  ]
  const displayedEmbeddingError =
    embeddingError || (status === 'completed' ? document?.extraction_error : '')
  const canRegenerate =
    document &&
    !ACTIVE_PROCESSING_STATUSES.has(status) &&
    status !== 'failed' &&
    Boolean(embeddingStats?.chunk_count)
  const canSyncVectors =
    document &&
    !ACTIVE_PROCESSING_STATUSES.has(status) &&
    status !== 'failed' &&
    Boolean(embeddingStats?.embedding_count)
  const canReprocess = document && !ACTIVE_PROCESSING_STATUSES.has(status)

  const renderInfoItem = (item) => (
    <div key={item.label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</p>
      {item.type === 'status' ? (
        <span
          className={`mt-2 inline-flex h-7 max-w-full items-center rounded-full border px-2.5 text-xs font-semibold ${
            item.className || searchStatusClass[item.value] || searchStatusClass.Processing
          }`}
        >
          {item.value}
        </span>
      ) : (
        <p className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-white sm:text-base">
          {item.type === 'number' ? formatNumber(item.value) : item.value}
        </p>
      )}
    </div>
  )

  return (
    <div className="mb-4 space-y-3 border-b border-slate-200 pb-4 dark:border-white/10">
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.035]">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <BookOpen className="h-4 w-4 text-sky-600 dark:text-comet" />
          Document Summary
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading summary
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <div key={item.label} className="min-w-0">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</p>
                {item.type === 'status' ? (
                  <span
                    className={`mt-2 inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${
                      searchStatusClass[item.value] || searchStatusClass.Processing
                    }`}
                  >
                    {item.value}
                  </span>
                ) : (
                  <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{item.value}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-900 marker:hidden dark:text-white">
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-sky-600 dark:text-comet" />
            Advanced Information
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-slate-200 p-4 dark:border-white/10">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Cpu className="h-4 w-4 text-sky-600 dark:text-comet" />
              Embeddings
            </div>

            {displayedEmbeddingError && (
              <div className="mb-3 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{displayedEmbeddingError}</span>
              </div>
            )}

            {embeddingLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading embeddings
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {embeddingItems.map(renderInfoItem)}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Database className="h-4 w-4 text-sky-600 dark:text-comet" />
              Vector Storage
            </div>

            {vectorError && (
              <div className="mb-3 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{vectorError}</span>
              </div>
            )}

            {vectorLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading vector storage
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {vectorItems.map(renderInfoItem)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-white/10">
            <button
              type="button"
              className="secondary-button py-2"
              onClick={onSyncVectors}
              disabled={!canSyncVectors || syncingVectors}
            >
              {syncingVectors ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync Vectors
            </button>
            <button
              type="button"
              className="secondary-button py-2"
              onClick={onRegenerateEmbeddings}
              disabled={!canRegenerate || regeneratingEmbeddings}
            >
              {regeneratingEmbeddings ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate
            </button>
            <button
              type="button"
              className="secondary-button py-2"
              onClick={onReprocess}
              disabled={!canReprocess || reprocessing}
            >
              {reprocessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Reprocess
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

function ChunksModal({ chunksPayload, document, error, loading, onClose, onQueryChange, query }) {
  const chunks = chunksPayload?.chunks ?? EMPTY_CHUNKS
  const status = getDocumentStatus(document)
  const highlightedChunks = useMemo(
    () =>
      chunks.map((chunk) => ({
        ...chunk,
        highlight: buildHighlightedSegments(chunk.content, query),
      })),
    [chunks, query],
  )
  const matchCount = highlightedChunks.reduce((total, chunk) => total + chunk.highlight.count, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 dark:border-white/10 sm:p-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <ProcessingStatusBadge status={status} />
              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:border-white/10 dark:text-slate-300">
                {formatNumber(chunksPayload?.chunk_count || chunks.length)} sections
              </span>
            </div>
            <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white sm:text-lg">
              {document?.original_filename}
            </h2>
          </div>

          <button type="button" className="icon-button shrink-0" onClick={onClose} aria-label="Close chunks">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-200 p-4 dark:border-white/10 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="field rounded-xl py-2 pl-9"
                type="search"
                placeholder="Search sections"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                disabled={!chunks.length}
              />
            </label>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {query.trim()
                ? `${formatNumber(matchCount)} match${matchCount === 1 ? '' : 'es'}`
                : `${formatNumber(chunks.length)} section${chunks.length === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100 sm:mx-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-[360px] space-y-3 overflow-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sections
            </div>
          ) : chunks.length ? (
            highlightedChunks.map((chunk) => (
              <article
                key={chunk.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    Section {chunk.chunk_index + 1}
                  </h3>
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                  {chunk.highlight.segments.map((segment, index) =>
                    segment.match ? (
                      <mark key={index} className="rounded bg-amber-200 px-0.5 text-slate-950">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </pre>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
              {ACTIVE_PROCESSING_STATUSES.has(status)
                ? 'Sections will be available after document processing completes.'
                : 'No sections were indexed for this document.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SourcesSection({ citations }) {
  const [expanded, setExpanded] = useState(false)
  const displayedCitations = expanded ? citations : citations.slice(0, 5)
  const hiddenCount = citations.length - 5

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-950 dark:text-white">
          Sources Used <span className="font-normal text-slate-500 dark:text-slate-400">({citations.length})</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {displayedCitations.map((citation) => (
          <div
            key={`${citation.document_id}-${citation.chunk_id}`}
            className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:border-comet/30 dark:bg-comet/10 dark:text-comet"
          >
            <span className="truncate">{citation.filename}</span>
            <span className="shrink-0 text-slate-500 dark:text-slate-400">•</span>
            <span className="shrink-0">S{(citation.chunk_index || 0) + 1}</span>
          </div>
        ))}
      </div>
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-sky-600 transition hover:text-sky-700 dark:text-comet dark:hover:text-comet/80"
          onClick={() => setExpanded(true)}
        >
          +{hiddenCount} more source{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-sky-600 transition hover:text-sky-700 dark:text-comet dark:hover:text-comet/80"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  )
}

function TestRagPanel({ conversationMessages = [], disabled = false, error, loading, onSubmit, result }) {
  const [query, setQuery] = useState('')
  const citations = result?.citations ?? []
  const visibleMessages =
    conversationMessages.length > 0
      ? conversationMessages
      : result
        ? [{ id: 'latest-answer', role: 'assistant', content: result.answer, citations }]
        : []

  const handleSubmit = (event) => {
    event.preventDefault()
    const cleanedQuery = query.trim()
    if (!cleanedQuery || loading || disabled) return
    setQuery('')
    onSubmit(cleanedQuery)
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05] sm:p-5">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-white">
              <MessageSquare className="h-5 w-5 text-sky-600 dark:text-comet" />
              Ask This Document
            </div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
              Ask questions directly about the selected document.
            </p>
          </div>
          <button
            type="submit"
            className="primary-button h-10 shrink-0 px-4 py-2"
            disabled={disabled || loading || !query.trim()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            Ask Document
          </button>
        </div>

        <textarea
          className="field min-h-[96px] resize-y rounded-xl"
          placeholder="What are the effects of microgravity on plants?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled || loading}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-comet/30 dark:hover:bg-comet/10"
            onClick={() => setQuery('Summarize the main findings and conclusions of this document.')}
            disabled={disabled || loading}
          >
            Summarize
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-comet/30 dark:hover:bg-comet/10"
            onClick={() => setQuery('What are the key findings and results presented in this document?')}
            disabled={disabled || loading}
          >
            Key Findings
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-comet/30 dark:hover:bg-comet/10"
            onClick={() => setQuery('Explain the methodology and research approach used in this study.')}
            disabled={disabled || loading}
          >
            Methodology
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-comet/30 dark:hover:bg-comet/10"
            onClick={() => setQuery('What future work or research directions are suggested in this document?')}
            disabled={disabled || loading}
          >
            Future Work
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-comet/30 dark:hover:bg-comet/10"
            onClick={() => setQuery('Explain the contents of this document in simple, easy-to-understand terms.')}
            disabled={disabled || loading}
          >
            Explain Simply
          </button>
        </div>

        {error && (
          <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {visibleMessages.length > 0 && (
          <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-white/10">
            {visibleMessages.map((message, index) => {
              const messageCitations = message.citations || message.citations_json || []
              const isUser = message.role === 'user'
              return (
                <div
                  key={message.id || `${message.role}-${index}`}
                  className={`rounded-2xl border p-4 ${
                    isUser
                      ? 'border-sky-200 bg-sky-50 dark:border-comet/30 dark:bg-comet/10'
                      : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]'
                  }`}
                >
                  <p className="mb-2 text-sm font-semibold text-slate-950 dark:text-white">
                    {isUser ? 'Question' : 'Answer'}
                  </p>
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                    {message.content}
                  </pre>

                  {!isUser && messageCitations.length > 0 && (
                    <div className="mt-4">
                      <SourcesSection citations={messageCitations} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </form>
    </section>
  )
}

export default function KnowledgeLibraryPage() {
  const navigate = useNavigate()
  const { setHistoryState } = useOutletContext()
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const [documents, setDocuments] = useState([])
  const [documentSummaries, setDocumentSummaries] = useState({})
  const [selectedDocumentId, setSelectedDocumentId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [reprocessingId, setReprocessingId] = useState(null)
  const [textModalOpen, setTextModalOpen] = useState(false)
  const [textPayload, setTextPayload] = useState(null)
  const [textLoading, setTextLoading] = useState(false)
  const [textError, setTextError] = useState('')
  const [textSearch, setTextSearch] = useState('')
  const [chunkStats, setChunkStats] = useState(null)
  const [chunkStatsLoading, setChunkStatsLoading] = useState(false)
  const [embeddingStats, setEmbeddingStats] = useState(null)
  const [embeddingStatsLoading, setEmbeddingStatsLoading] = useState(false)
  const [embeddingError, setEmbeddingError] = useState('')
  const [regeneratingEmbeddingId, setRegeneratingEmbeddingId] = useState(null)
  const [vectorStoreStats, setVectorStoreStats] = useState(null)
  const [vectorStoreHealth, setVectorStoreHealth] = useState(null)
  const [vectorStats, setVectorStats] = useState(null)
  const [vectorStatsLoading, setVectorStatsLoading] = useState(false)
  const [vectorError, setVectorError] = useState('')
  const [syncingVectorId, setSyncingVectorId] = useState(null)
  const [chunksModalOpen, setChunksModalOpen] = useState(false)
  const [chunksPayload, setChunksPayload] = useState(null)
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState('')
  const [chunksSearch, setChunksSearch] = useState('')
  const [ragPayload, setRagPayload] = useState(null)
  const [ragLoading, setRagLoading] = useState(false)
  const [ragError, setRagError] = useState('')
  const [libraryConversations, setLibraryConversations] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [libraryMessages, setLibraryMessages] = useState([])
  const [error, setError] = useState('')
  const activeConversationKey = useMemo(
    () => `nasa_agent_active_library_conversation_id_${user?.id || 'guest'}`,
    [user?.id],
  )

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  )

  const activeLibraryConversation = useMemo(
    () => libraryConversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, libraryConversations],
  )

  const hasActiveProcessing = useMemo(
    () => documents.some((document) => ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(document))),
    [documents],
  )

  const replaceLibraryConversation = useCallback((conversation, { promote = false } = {}) => {
    const normalized = normalizeLibraryConversation(conversation)

    setLibraryConversations((current) => {
      const existing = current.find((item) => item.id === normalized.id)
      const merged = {
        ...existing,
        ...normalized,
        messages: normalized.messages.length > 0 ? normalized.messages : existing?.messages || [],
      }
      const rest = current.filter((item) => item.id !== merged.id)
      if (promote) {
        return [merged, ...rest]
      }
      const next = current.some((item) => item.id === merged.id)
        ? current.map((item) => (item.id === merged.id ? merged : item))
        : [merged, ...current]
      return sortLibraryConversations(next)
    })
  }, [])

  const loadLibraryConversations = useCallback(async () => {
    setLibraryLoading(true)
    setRagError('')

    try {
      const data = await getLibraryConversations()
      const normalized = sortLibraryConversations(data.map(normalizeLibraryConversation))
      const savedId = Number(localStorage.getItem(activeConversationKey))
      const savedConversation = normalized.find((conversation) => conversation.id === savedId)

      setLibraryConversations(normalized)

      if (!savedConversation) {
        setActiveConversationId(null)
        setLibraryMessages([])
        setRagPayload(null)
        return
      }

      const fullConversation = normalizeLibraryConversation(await getLibraryConversation(savedConversation.id))
      setActiveConversationId(fullConversation.id)
      setLibraryMessages(fullConversation.messages)
      setRagPayload(getLastAssistantResult(fullConversation.messages))
      if (fullConversation.selected_document_id) {
        setSelectedDocumentId(fullConversation.selected_document_id)
      }
      replaceLibraryConversation(fullConversation)
    } catch (err) {
      setRagError(getApiError(err, 'Could not load library conversations.'))
    } finally {
      setLibraryLoading(false)
    }
  }, [activeConversationKey, replaceLibraryConversation])

  const loadDocumentSummaries = useCallback(async (nextDocuments) => {
    if (!nextDocuments.length) {
      setDocumentSummaries({})
      return
    }

    const results = await Promise.allSettled(
      nextDocuments.map(async (document) => {
        const stats = await getKnowledgeDocumentChunkStats(document.id)
        return [document.id, stats]
      }),
    )

    setDocumentSummaries((current) => {
      const nextIds = new Set(nextDocuments.map((document) => document.id))
      const next = {}

      nextDocuments.forEach((document) => {
        next[document.id] = current[document.id] || null
      })

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const [documentId, stats] = result.value
          if (nextIds.has(documentId)) {
            next[documentId] = stats
          }
        }
      })

      return next
    })
  }, [])

  const loadDocuments = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }

    try {
      const data = await getKnowledgeDocuments()
      setDocuments(data)
      loadDocumentSummaries(data)
      setSelectedDocumentId((currentId) => {
        if (data.some((document) => document.id === currentId)) return currentId
        return data[0]?.id || null
      })
    } catch (err) {
      if (!silent) {
        setError(getApiError(err, 'Could not load knowledge documents.'))
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [loadDocumentSummaries])

  const loadDocumentText = useCallback(async (documentId, { silent = false } = {}) => {
    if (!silent) {
      setTextLoading(true)
      setTextError('')
    }

    try {
      const data = await getKnowledgeDocumentText(documentId)
      setTextPayload(data)
    } catch (err) {
      if (!silent) {
        setTextError(getApiError(err, 'Could not load extracted text.'))
      }
    } finally {
      if (!silent) {
        setTextLoading(false)
      }
    }
  }, [])

  const loadChunkStats = useCallback(async (documentId, { silent = false } = {}) => {
    if (!silent) {
      setChunkStatsLoading(true)
    }

    try {
      const data = await getKnowledgeDocumentChunkStats(documentId)
      setChunkStats(data)
    } catch {
      setChunkStats(null)
    } finally {
      if (!silent) {
        setChunkStatsLoading(false)
      }
    }
  }, [])

  const loadEmbeddingStats = useCallback(async (documentId, { silent = false } = {}) => {
    if (!silent) {
      setEmbeddingStatsLoading(true)
      setEmbeddingError('')
    }

    try {
      const data = await getKnowledgeDocumentEmbeddingStats(documentId)
      setEmbeddingStats(data)
    } catch (err) {
      setEmbeddingStats(null)
      if (!silent) {
        setEmbeddingError(getApiError(err, 'Could not load embedding information.'))
      }
    } finally {
      if (!silent) {
        setEmbeddingStatsLoading(false)
      }
    }
  }, [])

  const loadVectorStoreState = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setVectorError('')
    }

    try {
      const health = await getVectorStoreHealth()
      setVectorStoreHealth(health)
    } catch (err) {
      setVectorStoreHealth({ status: 'unhealthy', collection: 'knowledge_documents' })
      if (!silent) {
        setVectorError(getApiError(err, 'Could not load vector store health.'))
      }
    }

    try {
      const stats = await getVectorStoreStats()
      setVectorStoreStats(stats)
    } catch (err) {
      setVectorStoreStats(null)
      if (!silent) {
        setVectorError((current) => current || getApiError(err, 'Could not load vector store information.'))
      }
    }
  }, [])

  const loadVectorStats = useCallback(async (documentId, { silent = false } = {}) => {
    if (!silent) {
      setVectorStatsLoading(true)
      setVectorError('')
    }

    try {
      const data = await getKnowledgeDocumentVectorStats(documentId)
      setVectorStats(data)
    } catch (err) {
      setVectorStats(null)
      if (!silent) {
        setVectorError(getApiError(err, 'Could not load vector storage information.'))
      }
    } finally {
      if (!silent) {
        setVectorStatsLoading(false)
      }
    }
  }, [])

  const loadDocumentChunks = useCallback(async (documentId) => {
    setChunksLoading(true)
    setChunksError('')

    try {
      const data = await getKnowledgeDocumentChunks(documentId)
      setChunksPayload(data)
    } catch (err) {
      setChunksPayload(null)
      setChunksError(getApiError(err, 'Could not load document chunks.'))
    } finally {
      setChunksLoading(false)
    }
  }, [])

  const selectLibraryConversation = useCallback(
    async (conversation) => {
      setActiveConversationId(conversation.id)
      localStorage.setItem(activeConversationKey, String(conversation.id))
      setLibraryMessages(conversation.messages || [])
      setRagPayload(getLastAssistantResult(conversation.messages || []))
      setRagError('')
      setLibraryLoading(true)

      try {
        const fullConversation = normalizeLibraryConversation(await getLibraryConversation(conversation.id))
        replaceLibraryConversation(fullConversation)
        setLibraryMessages(fullConversation.messages)
        setRagPayload(getLastAssistantResult(fullConversation.messages))
        if (fullConversation.selected_document_id) {
          setSelectedDocumentId(fullConversation.selected_document_id)
        }
      } catch (err) {
        setRagError(getApiError(err, 'Could not load this library conversation.'))
      } finally {
        setLibraryLoading(false)
      }
    },
    [activeConversationKey, replaceLibraryConversation],
  )

  const newLibraryConversation = useCallback(() => {
    navigate('/app/library')
    setActiveConversationId(null)
    setLibraryMessages([])
    setRagPayload(null)
    setRagError('')
    localStorage.removeItem(activeConversationKey)
  }, [activeConversationKey, navigate])

  const renameLibraryChat = useCallback(
    async (conversationId, title) => {
      try {
        const updatedConversation = normalizeLibraryConversation(await renameLibraryConversation(conversationId, title))
        replaceLibraryConversation(updatedConversation)
        if (conversationId === activeConversationId) {
          setLibraryMessages(updatedConversation.messages)
          setRagPayload(getLastAssistantResult(updatedConversation.messages))
        }
      } catch (err) {
        setRagError(getApiError(err, 'Could not rename this library conversation.'))
      }
    },
    [activeConversationId, replaceLibraryConversation],
  )

  const deleteLibraryChat = useCallback(
    async (conversationId) => {
      try {
        await deleteLibraryConversation(conversationId)
        setLibraryConversations((current) => current.filter((conversation) => conversation.id !== conversationId))
        if (conversationId === activeConversationId) {
          setActiveConversationId(null)
          setLibraryMessages([])
          setRagPayload(null)
          localStorage.removeItem(activeConversationKey)
        }
      } catch (err) {
        setRagError(getApiError(err, 'Could not delete this library conversation.'))
      }
    },
    [activeConversationId, activeConversationKey],
  )

  const clearLibraryChats = useCallback(async () => {
    try {
      await Promise.all(libraryConversations.map((conversation) => deleteLibraryConversation(conversation.id)))
      setLibraryConversations([])
      setActiveConversationId(null)
      setLibraryMessages([])
      setRagPayload(null)
      setRagError('')
      localStorage.removeItem(activeConversationKey)
    } catch (err) {
      setRagError(getApiError(err, 'Could not clear library conversations.'))
    }
  }, [activeConversationKey, libraryConversations])

  const handleRagQuery = useCallback(async (query) => {
    if (!selectedDocument) {
      setRagError('Select a document before asking a library question.')
      return
    }

    setRagPayload(null)
    setRagLoading(true)
    setRagError('')

    try {
      const data = await askLibraryQuestion({
        conversation_id: activeConversationId,
        document_id: selectedDocument.id,
        question: query,
      })
      const fullConversation = normalizeLibraryConversation(await getLibraryConversation(data.conversation_id))

      replaceLibraryConversation(fullConversation, { promote: true })
      setActiveConversationId(fullConversation.id)
      localStorage.setItem(activeConversationKey, String(fullConversation.id))
      setLibraryMessages(fullConversation.messages)
      setRagPayload(getLastAssistantResult(fullConversation.messages) || data)
      if (fullConversation.selected_document_id) {
        setSelectedDocumentId(fullConversation.selected_document_id)
      }
    } catch (err) {
      setRagPayload(null)
      setRagError(getApiError(err, 'Document question failed. Please check that your documents are ready.'))
    } finally {
      setRagLoading(false)
    }
  }, [activeConversationId, activeConversationKey, replaceLibraryConversation, selectedDocument])

  useEffect(() => {
    setHistoryState({
      history: libraryConversations,
      loading: libraryLoading,
      activeChatId: activeConversationId,
      activeTitle: activeLibraryConversation?.title || 'Knowledge Library',
      selectChat: selectLibraryConversation,
      newChat: newLibraryConversation,
      renameChat: renameLibraryChat,
      deleteChat: deleteLibraryChat,
      clearChats: clearLibraryChats,
    })
  }, [
    activeConversationId,
    activeLibraryConversation,
    clearLibraryChats,
    deleteLibraryChat,
    libraryConversations,
    libraryLoading,
    newLibraryConversation,
    renameLibraryChat,
    selectLibraryConversation,
    setHistoryState,
  ])

  useEffect(() => {
    loadDocuments()
    loadLibraryConversations()
    loadVectorStoreState()
  }, [loadDocuments, loadLibraryConversations, loadVectorStoreState])

  useEffect(() => {
    if (!hasActiveProcessing) return undefined

    const interval = window.setInterval(() => {
      loadDocuments({ silent: true })
      loadVectorStoreState({ silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [hasActiveProcessing, loadDocuments, loadVectorStoreState])

  useEffect(() => {
    if (!selectedDocument) return

    loadChunkStats(selectedDocument.id)
    loadEmbeddingStats(selectedDocument.id)
    loadVectorStats(selectedDocument.id)
  }, [loadChunkStats, loadEmbeddingStats, loadVectorStats, selectedDocument])

  useEffect(() => {
    if (!selectedDocument || !ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(selectedDocument))) return undefined

    const interval = window.setInterval(() => {
      loadChunkStats(selectedDocument.id, { silent: true })
      loadEmbeddingStats(selectedDocument.id, { silent: true })
      loadVectorStats(selectedDocument.id, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [loadChunkStats, loadEmbeddingStats, loadVectorStats, selectedDocument])

  useEffect(() => {
    const modalStatus = textPayload?.status || getDocumentStatus(selectedDocument)
    if (!textModalOpen || !selectedDocument || !ACTIVE_PROCESSING_STATUSES.has(modalStatus)) return undefined

    const interval = window.setInterval(() => {
      loadDocumentText(selectedDocument.id, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [loadDocumentText, selectedDocument, textModalOpen, textPayload?.status])

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false

    async function loadPreview() {
      if (!selectedDocument) {
        setPreviewUrl('')
        return
      }

      setPreviewLoading(true)
      setError('')

      try {
        const blob = await getKnowledgeDocumentPreview(selectedDocument.id)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      } catch (err) {
        if (!cancelled) {
          setPreviewUrl('')
          setError(getApiError(err, 'Could not load document preview.'))
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      }
    }

    loadPreview()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedDocument])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.target
    const extension = file.name.split('.').pop()?.toLowerCase() || ''

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      setError('Unsupported file. Upload a PDF, PNG, JPG, or JPEG file.')
      input.value = ''
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File is too large. Maximum upload size is 25 MB.')
      input.value = ''
      return
    }

    setUploading(true)
    setError('')

    try {
      const document = await uploadKnowledgeDocument(file)
      const nextDocuments = [document, ...documents]
      setDocuments(nextDocuments)
      loadDocumentSummaries(nextDocuments)
      setSelectedDocumentId(document.id)
    } catch (err) {
      setError(getApiError(err, 'Upload failed.'))
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  async function handleOpenExtractedText(document) {
    setTextModalOpen(true)
    setTextPayload(null)
    setTextSearch('')
    await loadDocumentText(document.id)
  }

  async function handleOpenChunks(document) {
    setChunksModalOpen(true)
    setChunksPayload(null)
    setChunksSearch('')
    await loadDocumentChunks(document.id)
  }

  async function handleReprocess(document) {
    setReprocessingId(document.id)
    setError('')
    setTextError('')
    setEmbeddingError('')
    setVectorError('')

    try {
      const updatedDocument = await reprocessKnowledgeDocument(document.id)
      const nextDocuments = documents.map((item) => (item.id === updatedDocument.id ? updatedDocument : item))
      setDocuments(nextDocuments)
      loadDocumentSummaries(nextDocuments)
      if (textModalOpen && selectedDocument?.id === updatedDocument.id) {
        setTextPayload({
          id: updatedDocument.id,
          filename: updatedDocument.original_filename,
          type: updatedDocument.content_type,
          status: updatedDocument.processing_status,
          text: '',
          processed_at: updatedDocument.processed_at,
          extraction_error: updatedDocument.extraction_error,
        })
        setTextSearch('')
      }
      if (chunksModalOpen && selectedDocument?.id === updatedDocument.id) {
        setChunksPayload(null)
        setChunksSearch('')
        setChunksError('')
      }
      setChunkStats(null)
      setEmbeddingStats(null)
      setVectorStats(null)
      loadVectorStoreState({ silent: true })
    } catch (err) {
      const message = getApiError(err, 'Could not reprocess document.')
      if (textModalOpen) {
        setTextError(message)
      } else {
        setError(message)
      }
    } finally {
      setReprocessingId(null)
    }
  }

  async function handleRegenerateEmbeddings(document) {
    setRegeneratingEmbeddingId(document.id)
    setEmbeddingError('')
    setVectorError('')

    try {
      const data = await regenerateKnowledgeDocumentEmbeddings(document.id)
      setEmbeddingStats(data)
      await Promise.all([
        loadVectorStats(document.id, { silent: true }),
        loadVectorStoreState({ silent: true }),
      ])
    } catch (err) {
      setEmbeddingError(getApiError(err, 'Could not regenerate embeddings.'))
    } finally {
      setRegeneratingEmbeddingId(null)
    }
  }

  async function handleSyncVectors(document) {
    setSyncingVectorId(document.id)
    setVectorError('')

    try {
      const data = await syncKnowledgeDocumentVectors(document.id)
      setVectorStats(data)
      await Promise.all([
        loadVectorStoreState({ silent: true }),
      ])
    } catch (err) {
      setVectorError(getApiError(err, 'Could not sync vectors.'))
    } finally {
      setSyncingVectorId(null)
    }
  }

  async function handleDelete(document) {
    const confirmed = window.confirm(`Delete "${document.original_filename}"?`)
    if (!confirmed) return

    setDeletingId(document.id)
    setError('')

    try {
      await deleteKnowledgeDocument(document.id)
      const nextDocuments = documents.filter((item) => item.id !== document.id)
      setDocuments(nextDocuments)
      setDocumentSummaries((current) => {
        const next = { ...current }
        delete next[document.id]
        return next
      })
      setSelectedDocumentId((currentId) => (currentId === document.id ? nextDocuments[0]?.id || null : currentId))
      setVectorStats(null)
      loadVectorStoreState({ silent: true })
    } catch (err) {
      setError(getApiError(err, 'Could not delete document.'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PageTransition className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-comet">
                <Library className="h-4 w-4" />
                Knowledge Library
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                Knowledge Library
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                Upload research papers, reports, and documents for AI-powered search and analysis.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={handleUpload}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Document
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <TestRagPanel
          conversationMessages={libraryMessages}
          disabled={!selectedDocument}
          error={ragError}
          loading={ragLoading}
          onSubmit={handleRagQuery}
          result={ragPayload}
        />

        <section className="grid min-h-[620px] gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">Documents</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Open a document to review its summary, preview, and analysis tools.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 dark:border-white/10 dark:text-slate-300">
                {documents.length}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.04]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading documents
              </div>
            ) : documents.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-white/10">
                <Library className="mb-4 h-11 w-11 text-sky-600 dark:text-comet" />
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">No documents yet</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-400">
                  Upload your first research paper to begin searching, analyzing, and chatting with your knowledge base.
                </p>
                <button
                  type="button"
                  className="primary-button mt-5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload Document
                </button>
              </div>
            ) : (
              <div className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
                {documents.map((document) => {
                  const active = selectedDocumentId === document.id
                  const summary = documentSummaries[document.id]
                  return (
                    <article
                      key={document.id}
                      className={`rounded-2xl border p-4 transition ${
                        active
                          ? 'border-sky-300 bg-sky-50 shadow-sm dark:border-comet/40 dark:bg-comet/10'
                          : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/70 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="flex gap-3">
                        <DocumentIcon document={document} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="min-w-0 truncate text-base font-semibold text-slate-950 dark:text-white">
                              {document.original_filename}
                            </h3>
                            <ProcessingStatusBadge status={getDocumentStatus(document)} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                            <span>{formatPageCount(summary?.page_count || 0)}</span>
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="h-3.5 w-3.5" />
                              Uploaded {formatShortDate(document.uploaded_at)}
                            </span>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="secondary-button px-3 py-2"
                              onClick={() => setSelectedDocumentId(document.id)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="secondary-button px-3 py-2 text-red-600 dark:text-red-200"
                              onClick={() => handleDelete(document)}
                              disabled={deletingId === document.id}
                            >
                              {deletingId === document.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            {selectedDocument ? (
              <div className="flex h-full min-h-[520px] flex-col">
                <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <DocumentIcon document={selectedDocument} />
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                        {selectedDocument.original_filename}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <ProcessingStatusBadge status={getDocumentStatus(selectedDocument)} />
                        <p className="text-xs text-slate-500">
                          {formatPageCount(chunkStats?.page_count || 0)} · Uploaded {formatShortDate(selectedDocument.uploaded_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      className="secondary-button py-2"
                      onClick={() => handleOpenExtractedText(selectedDocument)}
                    >
                      <FileSearch className="h-4 w-4" />
                      View Text
                    </button>
                    <button
                      type="button"
                      className="secondary-button py-2"
                      onClick={() => handleOpenChunks(selectedDocument)}
                    >
                      <Layers className="h-4 w-4" />
                      View Sections
                    </button>
                    {previewUrl && (
                      <a
                        className="secondary-button py-2"
                        href={previewUrl}
                        download={selectedDocument.original_filename}
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </a>
                    )}
                    <button
                      type="button"
                      className="secondary-button py-2 text-red-600 dark:text-red-200"
                      onClick={() => handleDelete(selectedDocument)}
                      disabled={deletingId === selectedDocument.id}
                    >
                      {deletingId === selectedDocument.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>

                <DocumentAnalyticsCard
                  document={selectedDocument}
                  embeddingError={embeddingError}
                  embeddingLoading={embeddingStatsLoading}
                  embeddingStats={embeddingStats}
                  loading={chunkStatsLoading}
                  onRegenerateEmbeddings={() => handleRegenerateEmbeddings(selectedDocument)}
                  onReprocess={() => handleReprocess(selectedDocument)}
                  onSyncVectors={() => handleSyncVectors(selectedDocument)}
                  regeneratingEmbeddings={regeneratingEmbeddingId === selectedDocument.id}
                  reprocessing={reprocessingId === selectedDocument.id}
                  stats={chunkStats}
                  syncingVectors={syncingVectorId === selectedDocument.id}
                  vectorError={vectorError}
                  vectorHealth={vectorStoreHealth}
                  vectorLoading={vectorStatsLoading}
                  vectorStats={vectorStats}
                  vectorStoreStats={vectorStoreStats}
                />

                {getDocumentStatus(selectedDocument) === 'failed' && (
                  <div className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{selectedDocument.extraction_error || 'Extraction failed. Open Advanced Information to process the document again.'}</span>
                  </div>
                )}

                <div className="relative max-h-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/40">
                  {previewLoading ? (
                    <div className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading preview
                    </div>
                  ) : selectedDocument.content_type === 'application/pdf' ? (
                    <iframe
                      className="h-full min-h-[500px] w-full"
                      src={previewUrl}
                      title={selectedDocument.original_filename}
                    />
                  ) : (
                    <div className="flex h-full min-h-[500px] items-center justify-center overflow-auto p-4">
                      <img
                        className="max-h-full max-w-full rounded-xl object-contain"
                        src={previewUrl}
                        alt={selectedDocument.original_filename}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[500px] flex-col items-center justify-center text-center text-slate-500">
                <Library className="mb-4 h-10 w-10 text-sky-600 dark:text-comet" />
                <p className="text-sm">Select a document to preview it.</p>
              </div>
            )}
          </div>
        </section>

        {textModalOpen && selectedDocument && (
          <ExtractedTextModal
            document={selectedDocument}
            error={textError}
            loading={textLoading}
            onClose={() => setTextModalOpen(false)}
            onQueryChange={setTextSearch}
            query={textSearch}
            textPayload={textPayload}
          />
        )}

        {chunksModalOpen && selectedDocument && (
          <ChunksModal
            chunksPayload={chunksPayload}
            document={selectedDocument}
            error={chunksError}
            loading={chunksLoading}
            onClose={() => setChunksModalOpen(false)}
            onQueryChange={setChunksSearch}
            query={chunksSearch}
          />
        )}

      </div>
    </PageTransition>
  )
}
