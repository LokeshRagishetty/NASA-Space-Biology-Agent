import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
    return
  }

  delete api.defaults.headers.common.Authorization
}

export async function signupUser(payload) {
  const { data } = await api.post('/signup', payload)
  return data
}

export async function loginUser(payload) {
  const { data } = await api.post('/login', payload)
  return data
}

export async function googleLoginUser(idToken) {
  const { data } = await api.post('/google-login', { id_token: idToken })
  return data
}

export async function logoutUser() {
  const { data } = await api.post('/logout')
  return data
}

export async function getCurrentUser() {
  const { data } = await api.get('/me')
  return data
}

export async function getChatHistory() {
  const { data } = await api.get('/history')
  return data
}

export async function getConversations() {
  const { data } = await api.get('/conversations')
  return data
}

export async function createConversation(title) {
  const payload = title ? { title } : {}
  const { data } = await api.post('/conversations', payload)
  return data
}

export async function getConversation(conversationId) {
  const { data } = await api.get(`/conversations/${conversationId}`)
  return data
}

export async function renameConversation(conversationId, title) {
  const { data } = await api.patch(`/conversations/${conversationId}`, { title })
  return data
}

export async function deleteConversation(conversationId) {
  const { data } = await api.delete(`/conversations/${conversationId}`)
  return data
}

export async function clearConversations() {
  const { data } = await api.delete('/conversations')
  return data
}

export async function sendConversationMessage(conversationId, content) {
  const { data } = await api.post(`/conversations/${conversationId}/messages`, { content })
  return data
}

export async function getKnowledgeDocuments() {
  const { data } = await api.get('/knowledge/documents')
  return data
}

export async function uploadKnowledgeDocument(file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/knowledge/documents', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return data
}

export async function deleteKnowledgeDocument(documentId) {
  const { data } = await api.delete(`/knowledge/documents/${documentId}`)
  return data
}

export async function getKnowledgeDocumentPreview(documentId) {
  const { data } = await api.get(`/knowledge/documents/${documentId}/preview`, {
    responseType: 'blob',
  })
  return data
}

export async function getKnowledgeDocumentText(documentId) {
  const { data } = await api.get(`/knowledge/documents/${documentId}/text`)
  return data
}

export async function reprocessKnowledgeDocument(documentId) {
  const { data } = await api.post(`/knowledge/documents/${documentId}/reprocess`)
  return data
}

export async function getKnowledgeDocumentChunks(documentId) {
  const { data } = await api.get(`/documents/${documentId}/chunks`)
  return data
}

export async function getKnowledgeDocumentChunkStats(documentId) {
  const { data } = await api.get(`/documents/${documentId}/chunk-stats`)
  return data
}

export async function getKnowledgeDocumentEmbeddingStats(documentId) {
  const { data } = await api.get(`/documents/${documentId}/embedding-stats`)
  return data
}

export async function regenerateKnowledgeDocumentEmbeddings(documentId) {
  const { data } = await api.post(`/documents/${documentId}/regenerate-embeddings`)
  return data
}

export async function getVectorStoreStats() {
  const { data } = await api.get('/vector-store/stats')
  return data
}

export async function getVectorStoreHealth() {
  const { data } = await api.get('/vector-store/health')
  return data
}

export async function getKnowledgeDocumentVectorStats(documentId) {
  const { data } = await api.get(`/documents/${documentId}/vector-stats`)
  return data
}

export async function syncKnowledgeDocumentVectors(documentId) {
  const { data } = await api.post(`/documents/${documentId}/sync-vectors`)
  return data
}

export async function performSemanticSearch(query, topK) {
  const { data } = await api.post('/search', { query, top_k: topK })
  return data
}

export async function performDocumentSemanticSearch(documentId, query, topK) {
  const { data } = await api.post(`/documents/${documentId}/search`, { query, top_k: topK })
  return data
}

export async function getSearchStatistics() {
  const { data } = await api.get('/search-statistics')
  return data
}

export async function performRagQuery(query) {
  const { data } = await api.post('/rag/query', { query })
  return data
}

export async function askQuestion(question, sessionId) {
  const { data } = await api.post(
    '/ask',
    { question },
    {
      headers: {
        'X-Session-ID': sessionId,
      },
    },
  )
  return data
}

export function getApiError(error, fallback = 'Something went wrong. Please try again.') {
  const status = error?.response?.status

  if (!error?.response || error?.code === 'ERR_NETWORK') {
    return 'Backend unavailable. Check that the FastAPI server is running and reachable.'
  }

  if (status === 401) {
    return 'Your session expired. Please sign in again.'
  }

  if (status === 403) {
    return 'You do not have permission to perform this action.'
  }

  if (error?.response?.data?.detail) {
    const detail = error.response.data.detail
    if (Array.isArray(detail)) {
      return detail.map((item) => item.msg).join(' ')
    }
    return detail
  }

  if (status === 422) {
    return 'Invalid request. Please check the message and try again.'
  }

  if (status >= 500) {
    return 'The AI service returned an invalid response. Please retry in a moment.'
  }

  if (error?.message) {
    return error.message
  }

  return fallback
}
