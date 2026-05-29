import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  AlertCircle,
  BarChart3,
  Cpu,
  Download,
  FileSearch,
  FileImage,
  FileText,
  Layers,
  Library,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import PageTransition from '../components/PageTransition'
import {
  deleteKnowledgeDocument,
  getApiError,
  getKnowledgeDocumentChunks,
  getKnowledgeDocumentChunkStats,
  getKnowledgeDocumentEmbeddingStats,
  getKnowledgeDocumentText,
  getKnowledgeDocumentPreview,
  getKnowledgeDocuments,
  regenerateKnowledgeDocumentEmbeddings,
  reprocessKnowledgeDocument,
  uploadKnowledgeDocument,
} from '../services/api'

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg'])
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const ACTIVE_PROCESSING_STATUSES = new Set(['pending', 'processing'])
const EMPTY_CHUNKS = []

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat().format(value)
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
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
      label: 'Completed',
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
  onRetry,
  query,
  reprocessing,
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
                {query.trim() ? `${count} match${count === 1 ? '' : 'es'}` : `${text.length.toLocaleString()} chars`}
              </span>
              <button
                type="button"
                className="secondary-button py-2"
                onClick={onRetry}
                disabled={reprocessing || ACTIVE_PROCESSING_STATUSES.has(status)}
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
              {extractionError || 'Extraction failed. Reprocess the document to try again.'}
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
  regeneratingEmbeddings,
  stats,
}) {
  const statItems = [
    { label: 'Pages', value: stats?.page_count || 0 },
    { label: 'Extracted characters', value: stats?.extracted_characters || stats?.total_characters || 0 },
    { label: 'Chunks', value: stats?.chunk_count || 0 },
    { label: 'Estimated tokens', value: stats?.estimated_tokens || 0 },
  ]
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
  const embeddingItems = [
    { label: 'Embedding Status', value: embeddingStatus, type: 'status' },
    { label: 'Embedding Count', value: embeddingStats?.embedding_count || 0, type: 'number' },
    { label: 'Embedding Dimension', value: embeddingStats?.embedding_dimension || 0, type: 'number' },
    { label: 'Model Name', value: embeddingStats?.embedding_model || 'all-MiniLM-L6-v2', type: 'text' },
  ]
  const displayedEmbeddingError =
    embeddingError || (getDocumentStatus(document) === 'completed' ? document?.extraction_error : '')
  const canRegenerate =
    document &&
    !ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(document)) &&
    getDocumentStatus(document) !== 'failed' &&
    Boolean(embeddingStats?.chunk_count)

  return (
    <div className="mb-4 border-b border-slate-200 pb-4 dark:border-white/10">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <BarChart3 className="h-4 w-4 text-sky-600 dark:text-comet" />
        Document Analytics
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading analytics
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {statItems.map((item) => (
            <div
              key={item.label}
              className="min-w-0 border-l border-slate-200 pl-3 dark:border-white/10"
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{formatNumber(item.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-white/10">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Cpu className="h-4 w-4 text-sky-600 dark:text-comet" />
            Embedding Information
          </div>
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
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {embeddingItems.map((item) => (
              <div
                key={item.label}
                className="min-w-0 border-l border-slate-200 pl-3 dark:border-white/10"
              >
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</p>
                {item.type === 'status' ? (
                  <span
                    className={`mt-1 inline-flex h-7 max-w-full items-center rounded-full border px-2.5 text-xs font-semibold ${
                      embeddingStatusClass[item.value] || embeddingStatusClass.Missing
                    }`}
                  >
                    {item.value}
                  </span>
                ) : (
                  <p className="mt-1 break-words text-lg font-semibold text-slate-950 dark:text-white">
                    {item.type === 'number' ? formatNumber(item.value) : item.value}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
                {formatNumber(chunksPayload?.chunk_count || chunks.length)} chunks
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
                placeholder="Search chunks"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                disabled={!chunks.length}
              />
            </label>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {query.trim()
                ? `${formatNumber(matchCount)} match${matchCount === 1 ? '' : 'es'}`
                : `${formatNumber(chunks.length)} chunk${chunks.length === 1 ? '' : 's'}`}
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
              Loading chunks
            </div>
          ) : chunks.length ? (
            highlightedChunks.map((chunk) => (
              <article
                key={chunk.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    Chunk {chunk.chunk_index + 1}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <span>{formatNumber(chunk.char_count)} chars</span>
                    <span>{formatNumber(chunk.token_estimate)} tokens</span>
                  </div>
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
                ? 'Chunks will be available after document processing completes.'
                : 'No chunks were generated for this document.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function KnowledgeLibraryPage() {
  const navigate = useNavigate()
  const { setHistoryState } = useOutletContext()
  const fileInputRef = useRef(null)
  const [documents, setDocuments] = useState([])
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
  const [chunksModalOpen, setChunksModalOpen] = useState(false)
  const [chunksPayload, setChunksPayload] = useState(null)
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState('')
  const [chunksSearch, setChunksSearch] = useState('')
  const [error, setError] = useState('')

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  )

  const hasActiveProcessing = useMemo(
    () => documents.some((document) => ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(document))),
    [documents],
  )

  const loadDocuments = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }

    try {
      const data = await getKnowledgeDocuments()
      setDocuments(data)
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
  }, [])

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

  useEffect(() => {
    setHistoryState({
      history: [],
      loading: false,
      activeChatId: null,
      activeTitle: 'Knowledge Library',
      selectChat: () => {},
      newChat: () => navigate('/app'),
      renameChat: () => {},
      deleteChat: () => {},
      clearChats: () => {},
    })
  }, [navigate, setHistoryState])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocuments()
  }, [loadDocuments])

  useEffect(() => {
    if (!hasActiveProcessing) return undefined

    const interval = window.setInterval(() => {
      loadDocuments({ silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [hasActiveProcessing, loadDocuments])

  useEffect(() => {
    if (!selectedDocument) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChunkStats(selectedDocument.id)
    loadEmbeddingStats(selectedDocument.id)
  }, [loadChunkStats, loadEmbeddingStats, selectedDocument])

  useEffect(() => {
    if (!selectedDocument || !ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(selectedDocument))) return undefined

    const interval = window.setInterval(() => {
      loadChunkStats(selectedDocument.id, { silent: true })
      loadEmbeddingStats(selectedDocument.id, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [loadChunkStats, loadEmbeddingStats, selectedDocument])

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
      setDocuments((current) => [document, ...current])
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

    try {
      const updatedDocument = await reprocessKnowledgeDocument(document.id)
      setDocuments((current) => current.map((item) => (item.id === updatedDocument.id ? updatedDocument : item)))
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

    try {
      const data = await regenerateKnowledgeDocumentEmbeddings(document.id)
      setEmbeddingStats(data)
    } catch (err) {
      setEmbeddingError(getApiError(err, 'Could not regenerate embeddings.'))
    } finally {
      setRegeneratingEmbeddingId(null)
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
      setSelectedDocumentId((currentId) => (currentId === document.id ? nextDocuments[0]?.id || null : currentId))
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
                Document management
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                PDF, PNG, JPG, and JPEG files for your account.
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
                Upload file
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

        <section className="grid min-h-[560px] gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.05]">
            <div className="mb-3 flex items-center justify-between px-2 py-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Files</h2>
              <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 dark:border-white/10">
                {documents.length}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading documents
              </div>
            ) : documents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-white/10">
                No files uploaded yet.
              </div>
            ) : (
              <div className="max-h-[66vh] space-y-2 overflow-y-auto pr-1">
                {documents.map((document) => {
                  const active = selectedDocumentId === document.id
                  return (
                    <button
                      key={document.id}
                      type="button"
                      className={`flex w-full gap-3 rounded-2xl border p-3 text-left transition ${
                        active
                          ? 'border-sky-300 bg-sky-50 dark:border-comet/40 dark:bg-comet/10'
                          : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/70 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
                      }`}
                      onClick={() => setSelectedDocumentId(document.id)}
                    >
                      <DocumentIcon document={document} />
                      <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {document.original_filename}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {formatBytes(document.file_size)} · {document.file_extension.toUpperCase()}
                          </span>
                          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                            {formatDate(document.uploaded_at)}
                          </span>
                        </span>
                        <ProcessingStatusBadge status={getDocumentStatus(document)} />
                      </span>
                    </button>
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
                          {formatBytes(selectedDocument.file_size)} · uploaded {formatDate(selectedDocument.uploaded_at)}
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
                      View Extracted Text
                    </button>
                    <button
                      type="button"
                      className="secondary-button py-2"
                      onClick={() => handleOpenChunks(selectedDocument)}
                    >
                      <Layers className="h-4 w-4" />
                      View Chunks
                    </button>
                    <button
                      type="button"
                      className="secondary-button py-2"
                      onClick={() => handleReprocess(selectedDocument)}
                      disabled={
                        reprocessingId === selectedDocument.id ||
                        ACTIVE_PROCESSING_STATUSES.has(getDocumentStatus(selectedDocument))
                      }
                    >
                      {reprocessingId === selectedDocument.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Reprocess
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
                  regeneratingEmbeddings={regeneratingEmbeddingId === selectedDocument.id}
                  stats={chunkStats}
                />

                {getDocumentStatus(selectedDocument) === 'failed' && (
                  <div className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{selectedDocument.extraction_error || 'Extraction failed. Reprocess the document to try again.'}</span>
                  </div>
                )}

                <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950/40">
                  {previewLoading ? (
                    <div className="flex h-full min-h-[420px] items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading preview
                    </div>
                  ) : selectedDocument.content_type === 'application/pdf' ? (
                    <iframe
                      className="h-full min-h-[520px] w-full"
                      src={previewUrl}
                      title={selectedDocument.original_filename}
                    />
                  ) : (
                    <div className="flex h-full min-h-[520px] items-center justify-center overflow-auto p-4">
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
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center text-center text-slate-500">
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
            onRetry={() => handleReprocess(selectedDocument)}
            query={textSearch}
            reprocessing={reprocessingId === selectedDocument.id}
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
