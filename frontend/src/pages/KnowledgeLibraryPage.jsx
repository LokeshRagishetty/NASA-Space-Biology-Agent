import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  AlertCircle,
  Download,
  FileImage,
  FileText,
  Library,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import PageTransition from '../components/PageTransition'
import {
  deleteKnowledgeDocument,
  getApiError,
  getKnowledgeDocumentPreview,
  getKnowledgeDocuments,
  uploadKnowledgeDocument,
} from '../services/api'

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'

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

function DocumentIcon({ document }) {
  const isPdf = document.content_type === 'application/pdf'
  const Icon = isPdf ? FileText : FileImage
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-comet/10 dark:text-comet dark:ring-comet/20">
      <Icon className="h-5 w-5" />
    </span>
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
  const [error, setError] = useState('')

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  )

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = await getKnowledgeDocuments()
      setDocuments(data)
      setSelectedDocumentId((currentId) => {
        if (data.some((document) => document.id === currentId)) return currentId
        return data[0]?.id || null
      })
    } catch (err) {
      setError(getApiError(err, 'Could not load knowledge documents.'))
    } finally {
      setLoading(false)
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

    setUploading(true)
    setError('')

    try {
      const document = await uploadKnowledgeDocument(file)
      setDocuments((current) => [document, ...current])
      setSelectedDocumentId(document.id)
      event.target.value = ''
    } catch (err) {
      setError(getApiError(err, 'Upload failed.'))
    } finally {
      setUploading(false)
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
                      <span className="min-w-0 flex-1">
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
                      <p className="text-xs text-slate-500">
                        {formatBytes(selectedDocument.file_size)} · uploaded {formatDate(selectedDocument.uploaded_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
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
      </div>
    </PageTransition>
  )
}
