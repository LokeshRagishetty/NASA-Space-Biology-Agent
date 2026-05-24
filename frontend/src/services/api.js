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
  if (error?.response?.data?.detail) {
    const detail = error.response.data.detail
    if (Array.isArray(detail)) {
      return detail.map((item) => item.msg).join(' ')
    }
    return detail
  }

  if (error?.message) {
    return error.message
  }

  return fallback
}
